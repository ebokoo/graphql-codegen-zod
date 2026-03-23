# @softonus/zod

> **Generate Zod v4 validation schemas from your GraphQL Input types automatically**

> **Generate Zod v4 validation schemas from your GraphQL Input types automatically**

[![npm version](https://img.shields.io/npm/v/@softonus/zod)](https://www.npmjs.com/package/@softonus/zod)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## What is this?

`@softonus/zod` is a GraphQL Code Generator plugin that **automatically generates Zod v4 validation schemas** from your GraphQL Input types.

It's the **modern replacement for `typescript-validation-schema`** which has compatibility issues with Zod v4.

## Why do I need this?

- Generate validation schemas directly from your GraphQL schema
- No manual synchronization between GraphQL types and Zod schemas
- Full type inference with Zod v4
- Works perfectly with React Hook Form + Zod Resolver

## Quick Start

```bash
npm install @softonus/zod
```

```yaml
# codegen.ts
import { defineConfig } from 'graphql-codegen'

export default defineConfig({
  schema: 'http://localhost:4000/graphql',
  documents: 'gql/**/*.gql',
  generates: {
    'gql/': {
      preset: 'near-operation-file',
      plugins: [
        'typescript',
        'zod'
      ],
      config: {
        importFrom: '@/gql/graphql'
      }
    }
  }
})
```

## What it generates

Given a GraphQL schema with Input types:

```graphql
input CreateUserInput {
  name: String!
  email: String!
  age: Int
}
```

It generates `gql/auth/zod.ts` (grouped by module):

```typescript
import { z } from 'zod'

export function CreateUserInputSchema() {
  return z.object({
    name: z.string().min(1),
    email: z.string().email(),
    age: z.number().int().optional()
  })
}
```

## Usage with React Hook Form

```tsx
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { CreateUserInputSchema } from '@/gql/auth/zod'

function CreateUserForm() {
  const { register, handleSubmit } = useForm({
    resolver: zodResolver(CreateUserInputSchema())
  })

  // Form is automatically validated against GraphQL schema types! ✓
}
```

## Comparison

| Feature | typescript-validation-schema | @softonus/zod |
|---------|------------------------------|---------------------|
| Zod v4 support | ❌ Partial | ✅ Full |
| Type inference | ⚠️ Limited | ✅ Full |
| Per-module output | ❌ No | ✅ Yes |
| Custom scalars | ⚠️ Manual | ✅ Automatic |
| Schema grouping | ❌ Flat | ✅ By module |

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `importFrom` | `string` | `'@/gql/graphql'` | Import types from path |
| `groupByModule` | `boolean` | `true` | Group schemas by folder |
| `scalarSchemas` | `Record<string, string>` | See below | Custom scalar mappings |

### Default Scalar Schemas

```typescript
{
  ID: 'z.string().min(1)',
  String: 'z.string()',
  Int: 'z.number().int()',
  Boolean: 'z.boolean()',
  Float: 'z.number()',
  DateTime: 'z.string()',
  Email: 'z.string().email()',
  PhoneNumber: 'z.string().min(8)',
  JSON: 'z.record(z.string(), z.any())',
  Upload: 'z.instanceof(File)'
}
```

## FAQ

**Q: Can I use this with Zod v3?**
A: This plugin is designed for Zod v4. For Zod v3, use `typescript-validation-schema`.

**Q: How is the module grouping determined?**
A: Based on Input type naming convention. For example: `CreateUserInput` → `auth` module, `CreatePostInput` → `posts` module.

**Q: How do I customize scalar mappings?**
A: Pass `scalarSchemas` in the config:
```yaml
config:
  scalarSchemas:
    DateTime: 'z.string().datetime()'
```

**Q: Can I generate schemas for all Input types or just specific ones?**
A: All Input types in your GraphQL schema are automatically converted to Zod schemas.

## Example Output Structure

```
gql/
├── auth/
│   ├── graphql.ts      # GraphQL types
│   └── zod.ts         # SignInInputSchema, SignUpInputSchema, etc.
├── posts/
│   ├── graphql.ts
│   └── zod.ts         # CreatePostInputSchema, etc.
└── memorial/
    ├── graphql.ts
    └── zod.ts         # CreateMemorialInputSchema, etc.
```

## License

MIT © [Ebo](https://github.com/ebokoo)
