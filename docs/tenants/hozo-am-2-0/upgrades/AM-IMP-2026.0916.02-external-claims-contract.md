# AM-IMP-2026.0916.02

Status: Installed

This correction sends Rental's canonical source id and the exact opaque LINE
group reference with every external legacy claim action. It also gives external
applicants private, named templates without enrolling them in Finance V3 or
granting any administrator or bank-account capability.

Deployment order is Rental first and AM Platform second. Production verification
must not create a synthetic financial claim; a real external vendor is the final
submission and template canary.

