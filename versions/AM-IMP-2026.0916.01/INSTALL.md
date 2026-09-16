# Install

1. Merge the reviewed change to the AM Platform `main` branch.
2. Let Render deploy the merged commit; startup applies `config/claims-group-modes.sql` idempotently.
3. In 「請款功能管理」 set vendor groups to 「外部廠商－單純請款」 and internal groups to 「內部同仁－V3 請款」.
4. Publish only legacy forms to external groups. The backend rejects V3 publication to external groups.
5. Verify one external vendor can open a legacy form and that an individually disabled member cannot.
