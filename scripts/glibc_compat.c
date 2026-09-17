/* scripts/glibc_compat.c
 *
 * GLIBC 2.35 & libstdc++ Backward Compatibility Shim for Clypra
 *
 * Purpose:
 *   Clypra targets Ubuntu 22.04 (glibc 2.35) so that .deb and .AppImage releases
 *   run out of the box on DeepinOS 23/25, Debian 12 (Bookworm, glibc 2.36),
 *   Ubuntu 22.04, and newer distributions.
 *
 *   The precompiled static binaries bundled by `ort = 2.0.0-rc.13` (used for
 *   MediaPipe AI tracking) were compiled against newer toolchains that reference:
 *     - __isoc23_strtol (glibc 2.38+)
 *     - __isoc23_strtoull (glibc 2.38+)
 *     - std::__cxx11::basic_string<wchar_t>::_M_replace_cold (GCC 13+ libstdc++)
 *
 *   By statically linking this shim, these symbols are resolved internally within
 *   the Clypra binary, eliminating any runtime dynamic dependency on GLIBC_2.38
 *   or GLIBCXX_3.4.31 while preserving 100% glibc 2.35 compatibility.
 */

#include <stdlib.h>
#include <wchar.h>

/* Forward ISO C23 string parsing functions to standard glibc 2.35 implementations */
long __isoc23_strtol(const char *nptr, char **endptr, int base) {
    return strtol(nptr, endptr, base);
}

unsigned long long __isoc23_strtoull(const char *nptr, char **endptr, int base) {
    return strtoull(nptr, endptr, base);
}

/*
 * GCC 13+ libstdc++ out-of-line string replacement cold-path helper:
 *   std::__cxx11::basic_string<wchar_t, std::char_traits<wchar_t>, std::allocator<wchar_t>>::_M_replace_cold(
 *       wchar_t* __p, unsigned long __len1, const wchar_t* __s,
 *       unsigned long __len2, unsigned long __how_much)
 *
 * Mangled Itanium C++ ABI symbol:
 *   _ZNSt7__cxx1112basic_stringIwSt11char_traitsIwESaIwEE15_M_replace_coldEPwmPKwmm
 */
void _ZNSt7__cxx1112basic_stringIwSt11char_traitsIwESaIwEE15_M_replace_coldEPwmPKwmm(
    wchar_t* __p, unsigned long __len1, const wchar_t* __s,
    unsigned long __len2, unsigned long __how_much)
{
    if (__len2 && __len2 <= __len1) {
        wmemmove(__p, __s, __len2);
    }
    if (__how_much && __len1 != __len2) {
        wmemmove(__p + __len2, __p + __len1, __how_much);
    }
    if (__len2 > __len1) {
        if (__s + __len2 <= __p + __len1) {
            wmemmove(__p, __s, __len2);
        } else if (__s >= __p + __len1) {
            const unsigned long __poff = (__s - __p) + (__len2 - __len1);
            wmemcpy(__p, __p + __poff, __len2);
        } else {
            wmemmove(__p, __s, __len2);
        }
    }
}
