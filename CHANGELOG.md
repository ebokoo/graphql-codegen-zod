# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-03-29

### Added
- GraphQL enum support - generates `z.enum([...])` for enum types
- Field-level `fieldRefinements` option - add custom `.refine()` chains per field
- `generateObjectTypes` option - generates `z.object()` schemas for output/object types
- `z.discriminatedUnion('__typename', [...])` for GraphQL unions
- Field description support - carries GraphQL field descriptions as `.describe()`
- Default value extraction from schema SDL
- Proper header comment with `@softonus/graphql-codegen-zod` package name

### Fixed
- Header comment now uses correct package name instead of generic `@graphql-codegen/zod`
- Shared/orphaned Input types (e.g. SocialsInput) are now properly included in output

## [1.0.0] - 2026-03-23

### Added
- Initial release
- Generates Zod v4 schemas from GraphQL Input types
- Per-module output support
- Custom scalar schema mappings
- Full type inference
