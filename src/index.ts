import { PluginFunction, PluginValidateFn, Types } from '@graphql-codegen/plugin-helpers'
import {
  GraphQLSchema,
  parse,
  Kind,
  InputObjectTypeDefinitionNode,
  GraphQLInputObjectType,
  GraphQLNonNull,
  GraphQLList,
  GraphQLInputField,
  GraphQLEnumType,
  GraphQLUnionType,
  GraphQLInterfaceType,
  GraphQLObjectType,
  EnumValueDefinitionNode,
  FieldDefinitionNode,
  GraphQLField,
} from 'graphql'

export interface ZodPluginConfig {
  /**
   * Import types from this path.
   * @default '@/gql/graphql'
   */
  importFrom?: string
  /**
   * Use Zod v4 record syntax.
   * @default true
   */
  useZodV4?: boolean
  /**
   * Group schemas by module/folder.
   * @default true
   */
  groupByModule?: boolean
  /**
   * Custom scalar mappings.
   * Example: { DateTime: 'z.string()' }
   */
  scalarSchemas?: Record<string, string>
  /**
   * Only generate schemas for this specific module.
   * If set, only Input types matching this module will be included.
   */
  module?: string
  /**
   * Field-level refinement chains.
   * Specify per-input-type, per-field custom Zod chains.
   * Example: { SignInInput: { email: '.refine(v => /@/.test(v), { message: "Must be an email" })' } }
   */
  fieldRefinements?: Record<string, Record<string, string>>
  /**
   * Also generate output/object type schemas (not just input schemas).
   * @default false
   */
  generateObjectTypes?: boolean
}

const DEFAULT_SCALAR_SCHEMAS: Record<string, string> = {
  ID: 'z.string().min(1)',
  String: 'z.string()',
  Int: 'z.number().int()',
  Boolean: 'z.boolean()',
  Float: 'z.number()',
  DateTime: 'z.string()',
  Email: 'z.string().email()',
  PhoneNumber: 'z.string().min(8)',
  JSON: 'z.record(z.string(), z.any())',
  Upload: 'z.instanceof(File)',
}

export const validate: PluginValidateFn<ZodPluginConfig> = async (
  _schema: GraphQLSchema,
  _documents: Types.DocumentFile[],
  _config: ZodPluginConfig,
  _outputFile: string
) => {
  // Validate config here if needed
}

export const plugin: PluginFunction<ZodPluginConfig> = (
  schema: GraphQLSchema,
  _documents: Types.DocumentFile[],
  config: ZodPluginConfig
) => {
  const scalarSchemas = { ...DEFAULT_SCALAR_SCHEMAS, ...config.scalarSchemas }
  const importFrom = config.importFrom || '@/gql/graphql'
  const fieldRefinements = config.fieldRefinements || {}
  const generateObjectTypes = config.generateObjectTypes ?? false

  // Build enum type map: name -> values[]
  const enumTypes = new Map<string, string[]>()
  for (const [typeName, type] of Object.entries(schema.getTypeMap())) {
    if (typeName.startsWith('__')) continue
    if (type.constructor.name === 'GraphQLEnumType') {
      const enumType = type as GraphQLEnumType
      enumTypes.set(typeName, enumType.getValues().map(v => v.value))
    }
  }

  // Find all Input types from schema
  const typeMap = schema.getTypeMap()
  const inputTypes: Array<{ name: string; node: InputObjectTypeDefinitionNode | null; graphqlType: GraphQLInputObjectType }> = []

  for (const [typeName, type] of Object.entries(typeMap)) {
    if (typeName.startsWith('__')) continue
    if (type.constructor.name !== 'GraphQLInputObjectType') continue

    inputTypes.push({
      name: typeName,
      node: (type as GraphQLInputObjectType).astNode as InputObjectTypeDefinitionNode || null,
      graphqlType: type as GraphQLInputObjectType,
    })
  }

  // Collect object/interface types for discriminated union support
  const objectTypes: Array<{ name: string; nodes: readonly FieldDefinitionNode[] | null; graphqlType: GraphQLObjectType | GraphQLInterfaceType; isInterface: boolean }> = []
  const unionTypes: Array<{ name: string; graphqlType: GraphQLUnionType }> = []

  for (const [typeName, type] of Object.entries(typeMap)) {
    if (typeName.startsWith('__')) continue
    const constructorName = type.constructor.name
    if (constructorName === 'GraphQLObjectType') {
      objectTypes.push({
        name: typeName,
        nodes: (type as GraphQLObjectType).astNode?.fields ?? null,
        graphqlType: type as GraphQLObjectType,
        isInterface: false,
      })
    } else if (constructorName === 'GraphQLInterfaceType') {
      objectTypes.push({
        name: typeName,
        nodes: (type as GraphQLInterfaceType).astNode?.fields ?? null,
        graphqlType: type as GraphQLInterfaceType,
        isInterface: true,
      })
    } else if (constructorName === 'GraphQLUnionType') {
      unionTypes.push({
        name: typeName,
        graphqlType: type as GraphQLUnionType,
      })
    }
  }

  // Group inputs by module
  const inputsByModule = new Map<string, string[]>()
  const targetModule = config.module

  for (const { name, node, graphqlType } of inputTypes) {
    if (!name.endsWith('Input')) continue

    const moduleName = getModuleName(name)
    if (targetModule && moduleName !== targetModule && moduleName !== '') continue

    const refinements = fieldRefinements[name] || {}
    const schemaCode = generateInputSchema(name, node, graphqlType, scalarSchemas, enumTypes, refinements)

    const existing = inputsByModule.get(moduleName) || []
    inputsByModule.set(moduleName, [...existing, schemaCode])
  }

  // Generate object/interface/union types
  const objectTypesByModule = new Map<string, string[]>()

  if (generateObjectTypes) {
    for (const objType of objectTypes) {
      const moduleName = getModuleName(objType.name)
      if (targetModule && moduleName !== targetModule) continue

      const schemaCode = generateObjectSchema(objType, scalarSchemas, enumTypes, objectTypes)
      if (!schemaCode) continue

      const existing = objectTypesByModule.get(moduleName) || []
      objectTypesByModule.set(moduleName, [...existing, schemaCode])
    }

    for (const unionType of unionTypes) {
      const moduleName = getModuleName(unionType.name)
      if (targetModule && moduleName !== targetModule) continue

      const schemaCode = generateUnionSchema(unionType, scalarSchemas, enumTypes, objectTypes)
      if (!schemaCode) continue

      const existing = objectTypesByModule.get(moduleName) || []
      objectTypesByModule.set(moduleName, [...existing, schemaCode])
    }
  }

  // Generate output
  let output = `/* eslint-disable */\n`
  output += `/**\n * @softonus/graphql-codegen-zod\n * Generated by graphql-codegen\n */\n\n`

  // Add imports
  output += `import { z } from 'zod'\n`

  output += '\n'

  // Generate schemas by module
  if (config.groupByModule !== false) {
    for (const [moduleName, schemas] of inputsByModule) {
      if (schemas.length === 0) continue

      output += `// ============ ${moduleName.toUpperCase()} INPUTS ============\n\n`
      output += schemas.join('\n\n')
      output += '\n\n'
    }

    for (const [moduleName, schemas] of objectTypesByModule) {
      if (schemas.length === 0) continue

      output += `// ============ ${moduleName.toUpperCase()} OUTPUTS ============\n\n`
      output += schemas.join('\n\n')
      output += '\n\n'
    }
  } else {
    for (const [, schemas] of inputsByModule) {
      output += schemas.join('\n\n')
      output += '\n\n'
    }
    for (const [, schemas] of objectTypesByModule) {
      output += schemas.join('\n\n')
      output += '\n\n'
    }
  }

  return {
    content: output,
  }
}

function getModuleName(typeName: string): string {
  const name = typeName
    .replace(/Input$/, '')
    .replace(/Create|Update|Delete|Output$/gi, '')
    .toLowerCase()

  const moduleMap: Record<string, string> = {
    'signin': 'auth',
    'signup': 'auth',
    'user': 'users',
    'password': 'auth',
    'reset': 'auth',
    'memorial': 'memorials',
    'post': 'posts',
    'comment': 'comments',
    'invitation': 'invitations',
    'invoice': 'invoices',
    'contact': 'contacts',
  }

  for (const [key, module] of Object.entries(moduleMap)) {
    if (name.includes(key)) {
      return module
    }
  }

  return ''
}

function generateInputSchema(
  typeName: string,
  node: InputObjectTypeDefinitionNode | null,
  graphqlType: GraphQLInputObjectType,
  scalarSchemas: Record<string, string>,
  enumTypes: Map<string, string[]>,
  refinements: Record<string, string>
): string {
  const schemaName = `${typeName.replace(/Input$/, '')}InputSchema`

  const fields: string[] = []

  if (node?.fields) {
    for (const field of node.fields) {
      const fieldName = field.name.value
      const description = field.description?.value
      const fieldType = generateFieldTypeFromAST(field.type, scalarSchemas, enumTypes, refinements, fieldName)
      const defaultValue = field.defaultValue !== undefined ? String(field.defaultValue) : null

      let fieldCode = `    ${fieldName}: ${fieldType}`
      if (description) {
        fieldCode = `    ${fieldName}: ${fieldType}.describe(${JSON.stringify(description)})`
      }
      if (defaultValue) {
        fieldCode += `.default(${defaultValue})`
      }

      fields.push(fieldCode)
    }
  } else {
    const typeFields = graphqlType.getFields()
    for (const field of Object.values(typeFields)) {
      const fieldName = field.name
      const fieldType = generateFieldTypeFromField(field, scalarSchemas, enumTypes, refinements, fieldName)

      let fieldCode = `    ${fieldName}: ${fieldType}`
      if (field.description) {
        fieldCode = `    ${fieldName}: ${fieldType}.describe(${JSON.stringify(field.description)})`
      }

      fields.push(fieldCode)
    }
  }

  return `export function ${schemaName}() {
  return z.object({
${fields.join(',\n')}
  })
}`
}

function generateObjectSchema(
  objType: { name: string; nodes: readonly FieldDefinitionNode[] | null; graphqlType: GraphQLObjectType | GraphQLInterfaceType; isInterface: boolean },
  scalarSchemas: Record<string, string>,
  enumTypes: Map<string, string[]>,
  allObjectTypes: Array<{ name: string; graphqlType: GraphQLObjectType | GraphQLInterfaceType }>
): string {
  const schemaName = `${objType.name}Schema`

  const fields: string[] = []

  if (objType.nodes) {
    for (const field of objType.nodes) {
      const fieldName = field.name.value
      const description = field.description?.value
      const fieldType = generateFieldTypeFromAST(field.type, scalarSchemas, enumTypes, {}, fieldName)

      let fieldCode = `    ${fieldName}: ${fieldType}`
      if (description) {
        fieldCode = `    ${fieldName}: ${fieldType}.describe(${JSON.stringify(description)})`
      }

      fields.push(fieldCode)
    }
  } else {
    const typeFields = (objType.graphqlType as GraphQLObjectType).getFields()
    for (const field of Object.values(typeFields)) {
      const fieldName = field.name
      const fieldType = generateFieldTypeFromGraphQLField(field, scalarSchemas, enumTypes)

      let fieldCode = `    ${fieldName}: ${fieldType}`
      if (field.description) {
        fieldCode = `    ${fieldName}: ${fieldType}.describe(${JSON.stringify(field.description)})`
      }

      fields.push(fieldCode)
    }
  }

  return `export function ${schemaName}() {
  return z.object({
${fields.join(',\n')}
  })
}`
}

function generateUnionSchema(
  unionType: { name: string; graphqlType: GraphQLUnionType },
  scalarSchemas: Record<string, string>,
  enumTypes: Map<string, string[]>,
  allObjectTypes: Array<{ name: string; graphqlType: GraphQLObjectType | GraphQLInterfaceType }>
): string {
  const possibleTypes = unionType.graphqlType.getTypes()
  if (possibleTypes.length === 0) return ''

  const variants = possibleTypes
    .map(t => {
      const variantSchema = `${t.name}Schema()`
      return `    ${t.name}: ${variantSchema}`
    })
    .join(',\n')

  return `export function ${unionType.name}Schema() {
  return z.discriminatedUnion('__typename', [
${variants}
  ])
}`
}

function generateFieldTypeFromAST(
  type: any,
  scalarSchemas: Record<string, string>,
  enumTypes: Map<string, string[]>,
  refinements: Record<string, string>,
  fieldName: string
): string {
  let baseType: string
  let isOptional = true
  let isArray = false

  let currentType = type
  while (currentType) {
    if (currentType.kind === Kind.NON_NULL_TYPE) {
      isOptional = false
      currentType = currentType.type
    } else if (currentType.kind === Kind.LIST_TYPE) {
      isArray = true
      currentType = currentType.type
    } else {
      break
    }
  }

  const typeName = typeof currentType.name === 'object' ? currentType.name.value : currentType.name

  baseType = resolveBaseType(typeName, scalarSchemas, enumTypes)

  // Apply modifiers
  if (isArray) {
    baseType = `z.array(${baseType})`
  }

  if (isOptional) {
    baseType = `${baseType}.optional()`
  }

  // Apply refinement if specified
  const refinement = refinements[fieldName]
  if (refinement) {
    baseType = `${baseType}${refinement}`
  }

  return baseType
}

function generateFieldTypeFromField(
  field: GraphQLInputField,
  scalarSchemas: Record<string, string>,
  enumTypes: Map<string, string[]>,
  refinements: Record<string, string>,
  fieldName: string
): string {
  let baseType: string
  let isOptional = true
  let isArray = false

  let currentType: any = field.type
  while (currentType) {
    const constructorName = currentType.constructor.name
    if (constructorName === 'GraphQLNonNull') {
      isOptional = false
      currentType = currentType.ofType
    } else if (constructorName === 'GraphQLList') {
      isArray = true
      currentType = currentType.ofType
    } else {
      break
    }
  }

  const typeName = currentType?.name
  baseType = resolveBaseType(typeName, scalarSchemas, enumTypes)

  if (isArray) {
    baseType = `z.array(${baseType})`
  }

  if (isOptional) {
    baseType = `${baseType}.optional()`
  }

  const refinement = refinements[fieldName]
  if (refinement) {
    baseType = `${baseType}${refinement}`
  }

  return baseType
}

function generateFieldTypeFromGraphQLField(
  field: GraphQLField<any, any>,
  scalarSchemas: Record<string, string>,
  enumTypes: Map<string, string[]>
): string {
  let baseType: string
  let isOptional = true
  let isArray = false

  let currentType: any = field.type
  while (currentType) {
    const constructorName = currentType.constructor.name
    if (constructorName === 'GraphQLNonNull') {
      isOptional = false
      currentType = currentType.ofType
    } else if (constructorName === 'GraphQLList') {
      isArray = true
      currentType = currentType.ofType
    } else {
      break
    }
  }

  const typeName = currentType?.name
  baseType = resolveBaseType(typeName, scalarSchemas, enumTypes)

  if (isArray) {
    baseType = `z.array(${baseType})`
  }

  if (isOptional) {
    baseType = `${baseType}.optional()`
  }

  return baseType
}

function resolveBaseType(
  typeName: string | undefined,
  scalarSchemas: Record<string, string>,
  enumTypes: Map<string, string[]>
): string {
  if (!typeName) return 'z.string()'

  if (typeName in scalarSchemas) {
    return scalarSchemas[typeName]
  }

  if (enumTypes.has(typeName)) {
    const values = enumTypes.get(typeName)!
    return `z.enum([${values.map(v => JSON.stringify(v)).join(', ')}])`
  }

  if (typeName.endsWith('Input')) {
    return `${typeName.replace(/Input$/, '')}InputSchema()`
  }

  if (typeName.endsWith('Output') || typeName.endsWith('Type')) {
    return `${typeName.replace(/Output|Type$/, '')}Schema()`
  }

  if (typeName === 'JSONObject') {
    return 'z.record(z.string(), z.any())'
  }

  return 'z.string()'
}

export default { plugin, validate }
