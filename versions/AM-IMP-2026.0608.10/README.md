# AM-IMP-2026.0608.10

## Notion Database View Layout Registry

This package starts the shared registry for Notion database table layouts.

The first registered layout is the LINE group options default table for HOZO_AM and SEVEN_AM.

## Purpose

Make recurring Notion table layout decisions durable, comparable, and reusable across AM-style projects without storing project secrets or live project data in AMCore.

## Included Layout

`line_group_options.default_table`

Visible property order:

1. `總控專案`
2. `群組顯示名稱`
3. `LINE對話名稱`
4. `候選來源權責項目`

The listed properties are the only visible table columns in the default table view.

## Data Separation

This package may share layout definitions and property names.

This package must not share Notion tokens, data source IDs as required shared values, customer records, task records, report records, message records, or attachment records.
