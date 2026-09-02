# Party A signed PDF handoff

After an individual Party A completes online signing, the protected signing
page now serves a derived **Party A signed / Party B pending** PDF to the next
signer. The PDF visibly contains the contract-bound Party A signature while the
Party B signature area remains empty.

The derived PDF is generated only after the runtime revalidates the original
issued PDF hash, signing-session relationship, Party A signature hash, byte
size, MIME type, signer profile, frozen bundle hash, and signature timestamp.
It does not replace the immutable issued document or its signing hash.

Every page identifies the document as a staged signing view rather than the
final dual-party completion PDF. The existing completion flow still produces
the final immutable PDF after Party B signs and internal confirmation succeeds.

