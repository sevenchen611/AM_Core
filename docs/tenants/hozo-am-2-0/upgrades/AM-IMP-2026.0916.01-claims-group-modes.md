# AM-IMP-2026.0916.01

Status: Installed

HOZO claim groups now have an explicit external or internal mode. External vendor groups keep only the safe, applicant-bound legacy claim flow and individual deny control; internal groups retain Finance Claims V3 identity and membership behavior.

The package also adds the explicit platform-owner RLS read policies required by notification recipient resolution while preserving forced tenant isolation for normal access.

Production deployment and the first external-group canary remain to be recorded.
