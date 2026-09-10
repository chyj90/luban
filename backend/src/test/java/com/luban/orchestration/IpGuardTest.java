package com.luban.orchestration;

import com.luban.orchestration.security.IpGuard;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** IpGuard SSRF 防护表驱动测试。 */
class IpGuardTest {

    private final IpGuard guard = new IpGuard();

    @Test
    void rejectsPrivateIpv4() {
        assertThatThrownBy(() -> guard.check("http://10.0.0.5/api"))
                .isInstanceOf(SecurityException.class);
        assertThatThrownBy(() -> guard.check("http://192.168.1.10/"))
                .isInstanceOf(SecurityException.class);
        assertThatThrownBy(() -> guard.check("http://172.16.0.9/"))
                .isInstanceOf(SecurityException.class);
        assertThatThrownBy(() -> guard.check("http://127.0.0.1:8080/admin"))
                .isInstanceOf(SecurityException.class);
        assertThatThrownBy(() -> guard.check("http://169.254.169.254/latest/meta-data"))
                .isInstanceOf(SecurityException.class);
        assertThatThrownBy(() -> guard.check("http://0.0.0.0/"))
                .isInstanceOf(SecurityException.class);
        assertThatThrownBy(() -> guard.check("http://100.64.1.1/"))
                .isInstanceOf(SecurityException.class);
    }

    @Test
    void rejectsLoopbackByHostname() {
        assertThatThrownBy(() -> guard.check("http://localhost/"))
                .isInstanceOf(SecurityException.class);
    }

    @Test
    void rejectsNonHttpSchemes() {
        assertThatThrownBy(() -> guard.check("file:///etc/passwd"))
                .isInstanceOf(SecurityException.class);
        assertThatThrownBy(() -> guard.check("ftp://example.com/"))
                .isInstanceOf(SecurityException.class);
    }

    @Test
    void rejectsUnresolvableHost() {
        assertThatThrownBy(() -> guard.check("http://this-host-does-not-exist-9x7y.invalid/"))
                .isInstanceOf(SecurityException.class);
    }

    @Test
    void allowsPublicInternetHost() {
        // example.com 是 IANA 保留的公网演示域名，解析为公网地址
        assertThatCode(() -> guard.check("https://example.com/api")).doesNotThrowAnyException();
    }
}
