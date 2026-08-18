package com.luban.util;

import java.security.*;
import java.security.spec.*;
import java.util.Base64;

public final class Ed25519Util {

    private Ed25519Util() {}

    public static KeyPair generateKeyPair() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("Ed25519");
            return generator.generateKeyPair();
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("Ed25519 is not supported", e);
        }
    }

    public static byte[] sign(byte[] privateKeyBytes, byte[] data) {
        try {
            PrivateKey privateKey = keyFactory().generatePrivate(
                    new PKCS8EncodedKeySpec(privateKeyBytes));
            Signature sig = Signature.getInstance("Ed25519");
            sig.initSign(privateKey);
            sig.update(data);
            return sig.sign();
        } catch (Exception e) {
            throw new RuntimeException("Ed25519 signing failed", e);
        }
    }

    public static boolean verify(byte[] publicKeyBytes, byte[] data, byte[] signature) {
        try {
            PublicKey publicKey = keyFactory().generatePublic(
                    new X509EncodedKeySpec(publicKeyBytes));
            Signature sig = Signature.getInstance("Ed25519");
            sig.initVerify(publicKey);
            sig.update(data);
            return sig.verify(signature);
        } catch (Exception e) {
            return false;
        }
    }

    public static String encodePublicKey(PublicKey publicKey) {
        return Base64.getEncoder().encodeToString(publicKey.getEncoded());
    }

    public static String encodePrivateKey(PrivateKey privateKey) {
        return Base64.getEncoder().encodeToString(privateKey.getEncoded());
    }

    public static PublicKey decodePublicKey(String base64Key) {
        try {
            byte[] keyBytes = Base64.getDecoder().decode(base64Key);
            return keyFactory().generatePublic(new X509EncodedKeySpec(keyBytes));
        } catch (Exception e) {
            throw new RuntimeException("Invalid public key", e);
        }
    }

    public static PrivateKey decodePrivateKey(String base64Key) {
        try {
            byte[] keyBytes = Base64.getDecoder().decode(base64Key);
            return keyFactory().generatePrivate(new PKCS8EncodedKeySpec(keyBytes));
        } catch (Exception e) {
            throw new RuntimeException("Invalid private key", e);
        }
    }

    private static KeyFactory keyFactory() {
        try {
            return KeyFactory.getInstance("Ed25519");
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("Ed25519 is not supported", e);
        }
    }
}