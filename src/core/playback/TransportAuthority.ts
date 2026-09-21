import type { PlaybackContext, PlaybackContextType, PlaybackContextStateSnapshot } from "./PlaybackContext";
import { SeekController, type SeekIntentInput } from "./seekController";
import { recordSeekRequested } from "@/lib/playback/syncMetrics";

export type AuthorityContextSwitchListener = (type: PlaybackContextType | null) => void;
export type AuthorityStateListener = (state: PlaybackContextStateSnapshot) => void;

/**
 * Transport Authority - Single source of truth for playback ownership.
 *
 * Ensures only one playback context (source or program) is active at a time.
 * Delegates transport commands (play, pause, seek) to the active context.
 */
export class TransportAuthority {
  private readonly seekController = new SeekController();
  private activeContext: PlaybackContext | null = null;
  private contexts = new Map<PlaybackContextType, PlaybackContext>();
  private _switchListeners = new Set<AuthorityContextSwitchListener>();
  private _stateListeners = new Set<AuthorityStateListener>();
  private _ctxUnsubscribe: (() => void) | null = null;
  /**
   * BUG-4 fix: Reference-counted pause latch for scrubbing.
   * Replaces the single `_wasPlayingBeforeScrub` boolean which was corrupted by
   * overlapping beginScrub/endScrub calls (e.g. rapid back-seeks or pointer events
   * arriving out of order). The clock is only resumed when depth drops back to zero.
   */
  private _scrubPauseDepth: number = 0;

  registerContext(context: PlaybackContext): void {
    if (this.contexts.has(context.type)) {
      console.warn(`[TransportAuthority] Context '${context.type}' already registered. Overwriting.`);
    }
    this.contexts.set(context.type, context);

    // Auto-activate first registered context if none active
    if (!this.activeContext) {
      this.setActiveContext(context.type);
    }
  }

  setActiveContext(type: PlaybackContextType): void {
    const next = this.contexts.get(type) ?? null;
    if (!next) {
      console.warn(`[TransportAuthority] No context registered for type: ${type}`);
      return;
    }

    this.seekController.invalidate();

    // Pause previous context before switching
    if (this.activeContext && this.activeContext !== next) {
      this.activeContext.pause();
    }

    // Unsubscribe from previous context state
    if (this._ctxUnsubscribe) {
      this._ctxUnsubscribe();
      this._ctxUnsubscribe = null;
    }

    this.activeContext = next;

    // Subscribe to new context's state changes
    this._ctxUnsubscribe = next.subscribe((snapshot) => {
      this._notifyStateListeners(snapshot);
    });

    this._notifySwitchListeners(type);
  }

  getActiveContext(): PlaybackContext | null {
    return this.activeContext;
  }

  getActiveType(): PlaybackContextType | null {
    return this.activeContext?.type ?? null;
  }

  // ─── Unified Transport Controls ────────────────────────────────────────

  play(): void {
    this.issueTransportIntent("playback");
    this.activeContext?.play();
  }

  /** Toggle the active context from its live state without a throttled UI snapshot. */
  togglePlayback(): void {
    const context = this.activeContext;
    if (!context) return;
    if (context.getState() === "playing") {
      context.pause();
    } else {
      context.play();
    }
  }

  pause(): void {
    this.issueTransportIntent("seek");
    this.activeContext?.pause();
  }

  stop(): void {
    this.issueTransportIntent("seek");
    this.activeContext?.stop();
  }

  seek(time: number, intent: Omit<SeekIntentInput, "time"> = { mode: "seek" }): void {
    recordSeekRequested();
    const isPlaying = this.getState() === "playing";
    this.seekController.request({
      time,
      ...intent,
      mode: isPlaying ? "playback" : (intent.mode ?? "seek"),
      ...(isPlaying && intent.allowKeyframeApprox === undefined ? { allowKeyframeApprox: true } : {}),
    });
    this.activeContext?.seek(time);
  }

  beginScrub(time: number, source: string = "playhead"): void {
    const isPlaying = this.getState() === "playing";
    if (isPlaying) {
      // Only pause and increment depth when we were actually playing.
      // This keeps the depth counter truthful: one increment per actual pause.
      this.pause();
      this._scrubPauseDepth++;
    }
    this.seekController.beginScrub({ time, source });
    this.activeContext?.seek(time);
  }

  updateScrub(time: number, velocityPxPerSecond?: number): void {
    this.seekController.updateScrub({ time, velocityPxPerSecond });
    this.activeContext?.seek(time);
  }

  endScrub(time: number): void {
    this.seekController.endScrub({ time });
    this.activeContext?.seek(time);
    if (this._scrubPauseDepth > 0) {
      this._scrubPauseDepth--;
      if (this._scrubPauseDepth === 0) {
        // All nested scrub gestures have ended — resume playback.
        this.play();
      }
    }
  }

  getSeekController(): SeekController {
    return this.seekController;
  }

  setSpeed(speed: number): void {
    this.activeContext?.setSpeed(speed);
  }

  getTime(): number {
    return this.activeContext?.getTime() ?? 0;
  }

  getDuration(): number {
    return this.activeContext?.getDuration() ?? 0;
  }

  getState() {
    return this.activeContext?.getState() ?? "stopped";
  }

  getSnapshot(): PlaybackContextStateSnapshot {
    return (
      this.activeContext?.getSnapshot() ?? {
        time: 0,
        state: "stopped" as const,
        duration: 0,
        speed: 1,
      }
    );
  }

  // ─── Subscriptions ─────────────────────────────────────────────────────

  subscribeToContextSwitch(listener: AuthorityContextSwitchListener): () => void {
    this._switchListeners.add(listener);
    return () => this._switchListeners.delete(listener);
  }

  subscribeToState(listener: AuthorityStateListener): () => void {
    this._stateListeners.add(listener);
    return () => this._stateListeners.delete(listener);
  }

  private _notifySwitchListeners(type: PlaybackContextType | null): void {
    this._switchListeners.forEach((l) => l(type));
  }

  private _notifyStateListeners(state: PlaybackContextStateSnapshot): void {
    this._stateListeners.forEach((l) => l(state));
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────

  dispose(): void {
    this.seekController.dispose();
    if (this._ctxUnsubscribe) {
      this._ctxUnsubscribe();
      this._ctxUnsubscribe = null;
    }
    this._switchListeners.clear();
    this._stateListeners.clear();
    this._scrubPauseDepth = 0;
    this.contexts.forEach((ctx) => ctx.dispose());
    this.contexts.clear();
    this.activeContext = null;
  }

  private issueTransportIntent(mode: "playback" | "seek"): void {
    const context = this.activeContext;
    if (!context) {
      this.seekController.invalidate();
      return;
    }
    this.seekController.request({ time: context.getTime(), mode });
  }
}
