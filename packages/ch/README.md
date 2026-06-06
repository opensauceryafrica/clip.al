# @clipal/ch

ClickHouse 24+ access layer. Owns the client (`ch`), the batch click insert
(`insertClicks`, JSONEachRow), and the parameterized analytics queries that back
the dashboard, link-detail page, and admin overview. The schema (DDL) lives in
`infra/clickhouse/init.sql`. All queries bind user input via `{name:Type}`
parameters — never string interpolation.
