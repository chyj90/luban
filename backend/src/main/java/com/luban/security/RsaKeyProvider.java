package com.luban.security;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PSource;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.interfaces.RSAPrivateCrtKey;
import java.security.spec.MGF1ParameterSpec;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.RSAPublicKeySpec;
import java.util.Base64;

/**
 * 敏感字段（如数据源密码）传输层信封加密：前端用公钥 RSA-OAEP 加密后提交，
 * 后端以私钥解密，再交由业务层 AES 落库。避免密码在 HTTP body / 日志中以明文出现。
 *
 * 密钥来源：app.security.rsa.private-key（PKCS#8 PEM，推荐）；未配置时启动生成一次性
 * 2048 密钥并告警（重启后旧密文失效，前端每次提交拉取最新公钥即可）。
 */
@Component
public class RsaKeyProvider {

    private static final Logger log = LoggerFactory.getLogger(RsaKeyProvider.class);
    private static final String TRANSFORMATION = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding";
    /**
     * 显式指定 OAEP 参数，确保 MGF1 也使用 SHA-256（与 Web Crypto API 的
     * { name: 'RSA-OAEP', hash: 'SHA-256' } 一致）。
     * Java 默认 OAEPWithSHA-256AndMGF1Padding 的 MGF1 实际用 SHA-1，会导致
     * 前端 Web Crypto API 加密的密文无法解密（BadPaddingException）。
     */
    public static final OAEPParameterSpec OAEP_PARAMS = new OAEPParameterSpec(
            "SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT);
    /** 密文前缀，标记该字段已做 RSA 信封加密 */
    public static final String PREFIX = "rsa:";

    private final PrivateKey privateKey;
    private final PublicKey publicKey;

    public RsaKeyProvider(@Value("${app.security.rsa.private-key:}") String privateKeySource) {
        try {
            String privateKeyPem = privateKeySource;
            String sourceDesc = "env";
            if (privateKeyPem != null && privateKeyPem.startsWith("file:")) {
                java.nio.file.Path path = java.nio.file.Path.of(privateKeyPem.substring("file:".length()));
                privateKeyPem = java.nio.file.Files.readString(path, StandardCharsets.UTF_8);
                sourceDesc = "file:" + path;
            }
            if (privateKeyPem != null && !privateKeyPem.isBlank()) {
                PrivateKey pk = parsePrivateKey(privateKeyPem);
                this.privateKey = pk;
                this.publicKey = derivePublicKey((RSAPrivateCrtKey) pk);
                log.info("RSA key loaded from {} pemLen={}", sourceDesc, privateKeyPem.length());
            } else {
                KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
                kpg.initialize(2048);
                KeyPair kp = kpg.generateKeyPair();
                this.privateKey = kp.getPrivate();
                this.publicKey = kp.getPublic();
                log.warn("未配置 app.security.rsa.private-key，已使用一次性 RSA 密钥（重启后旧密文失效）");
            }
        } catch (Exception e) {
            throw new IllegalStateException("RSA 密钥初始化失败", e);
        }
    }

    public String publicKeyPem() {
        return "-----BEGIN PUBLIC KEY-----\n"
                + Base64.getMimeEncoder(64, new byte[]{'\n'}).encodeToString(publicKey.getEncoded())
                + "\n-----END PUBLIC KEY-----";
    }

    /** 解密 rsa: 前缀后的 Base64 密文 */
    public String decrypt(String ciphertextBase64) {
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, privateKey, OAEP_PARAMS);
            byte[] plain = cipher.doFinal(Base64.getDecoder().decode(ciphertextBase64));
            return new String(plain, StandardCharsets.UTF_8);
        } catch (Exception e) {
            log.error("RSA decrypt failed: exception={}, msg={}, cipherLen={}, cipherStart={}",
                    e.getClass().getSimpleName(), e.getMessage(),
                    ciphertextBase64.length(),
                    ciphertextBase64.length() > 30 ? ciphertextBase64.substring(0, 30) : ciphertextBase64);
            throw new IllegalArgumentException("敏感字段解密失败：公钥可能已轮换，请刷新页面重试");
        }
    }

    private PrivateKey parsePrivateKey(String pem) {
        try {
            String base64 = pem
                    .replace("-----BEGIN PRIVATE KEY-----", "")
                    .replace("-----END PRIVATE KEY-----", "")
                    .replaceAll("\\s", "");
            byte[] der = Base64.getDecoder().decode(base64);
            return KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(der));
        } catch (Exception e) {
            throw new IllegalArgumentException("RSA 私钥格式无效，需为 PKCS#8 PEM", e);
        }
    }

    private PublicKey derivePublicKey(RSAPrivateCrtKey crt) throws Exception {
        RSAPublicKeySpec spec = new RSAPublicKeySpec(crt.getModulus(), crt.getPublicExponent());
        return KeyFactory.getInstance("RSA").generatePublic(spec);
    }
}