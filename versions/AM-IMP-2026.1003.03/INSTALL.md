# Install

Apply the reviewed binding store, binding capture and LINE IO changes together.
Run the synthetic regression suites and package check. Deploy the root platform
only after the reviewed commit is merged to GitHub main. Existing database tables
and environment settings remain sufficient.

Install into other standalone services separately only when requested. Do not copy
tenant data, message records, credentials or binding state between projects.
