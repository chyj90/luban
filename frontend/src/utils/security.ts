/**
 * 传输层信封加密（与后端 RsaKeyProvider 配套）
 *
 * 数据源密码等敏感字段提交前用平台 RSA 公钥（RSA-OAEP/SHA-256）加密为
 * "rsa:<base64>"，后端私钥解密后再 AES 落库，避免密码在 HTTP body / 日志明文出现。
 *
 * 约定：
 * - 只对敏感字段白名单加密，host/username 等普通字段保持明文；
 * - 占位符（未修改的密码 "••••••••"）与空值不加密——后端据此走"保留旧密码"分支；
 * - 加密失败直接抛错阻止提交，绝不降级为明文。
 */
import { get } from '@/api/client';

const SENSITIVE_KEYS = new Set([
  'password', 'apiKey', 'apiValue', 'bearerToken', 'authPassword',
  'token', 'secret', 'accessKey', 'accessToken',
]);

const PLACEHOLDER = '••••••••';
const PREFIX = 'rsa:';

let publicKeyPromise: Promise<CryptoKey> | null = null;

function pemToDer(pem: string): ArrayBuffer {
  const der = pem
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\s/g, '');
  const bin = atob(der);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function getRsaPublicKey(): Promise<CryptoKey> {
  if (!publicKeyPromise) {
    publicKeyPromise = get<{ publicKey: string }>('/security/public-key')
      .then((res) => crypto.subtle.importKey(
        'spki', pemToDer(res.data.publicKey),
        { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'],
      ))
      .catch((e) => {
        publicKeyPromise = null;
        throw new Error('获取平台公钥失败：' + (e?.message || e));
      });
  }
  return publicKeyPromise;
}

/** 加密单个明文为 rsa: 前缀密文 */
export async function encryptSecret(plain: string): Promise<string> {
  const key = await getRsaPublicKey();
  const enc = new TextEncoder().encode(plain);
  // hash 已在 importKey 时绑定到公钥，加密算法只需 name
  const algo: RsaOaepParams = { name: 'RSA-OAEP' };
  const cipher = await crypto.subtle.encrypt(
    algo,
    key,
    enc,
  );
  const bytes = new Uint8Array(cipher);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return PREFIX + btoa(bin);
}

/** 提交前对 config 敏感字段做信封加密（占位符与空值保持原样） */
export async function encryptConfigSecrets(config: Record<string, unknown>): Promise<void> {
  for (const [k, v] of Object.entries(config)) {
    if (typeof v === 'string' && SENSITIVE_KEYS.has(k) && v !== '' && v !== PLACEHOLDER) {
      config[k] = await encryptSecret(v);
    }
  }
}