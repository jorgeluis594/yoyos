const { createRequire } = require("node:module");

const expoRequire = createRequire(require.resolve("expo/package.json"));
const cliRequire = createRequire(expoRequire.resolve("@expo/cli/package.json"));
const forge = cliRequire("node-forge");

test("rejects extra DigestAlgorithm elements in RSA signatures", () => {
  const { publicKey, privateKey } = forge.pki.rsa.generateKeyPair({ bits: 1024 });
  const md = forge.md.sha256.create();
  md.update("message");
  const asn1 = forge.asn1;
  const node = (type, value, constructed = false) =>
    asn1.create(asn1.Class.UNIVERSAL, type, constructed, value);
  const algorithm = node(asn1.Type.SEQUENCE, [
    node(asn1.Type.OID, asn1.oidToDer(forge.oids.sha256).getBytes()),
    node(asn1.Type.NULL, ""),
    node(asn1.Type.OCTETSTRING, "garbage"),
  ], true);
  const digestInfo = node(asn1.Type.SEQUENCE, [
    algorithm,
    node(asn1.Type.OCTETSTRING, md.digest().getBytes()),
  ], true);
  const forged = privateKey.sign(asn1.toDer(digestInfo).getBytes(), "NONE");

  expect(() => publicKey.verify(md.digest().getBytes(), forged)).toThrow(
    "ASN.1 object does not contain a valid RSASSA-PKCS1-v1_5 DigestInfo value.",
  );
  expect(publicKey.verify(md.digest().getBytes(), privateKey.sign(md))).toBe(true);
});
