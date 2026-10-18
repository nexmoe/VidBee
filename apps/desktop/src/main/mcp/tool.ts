import type { Tool, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

export interface DesktopMcpTool {
  definition: Tool
  execute: (input: unknown, signal: AbortSignal) => Promise<unknown>
}

export const mcpId = z.string().min(1).max(200)
export const mcpOffset = z.number().int().nonnegative().default(0)
export const mcpLimit = z.number().int().min(1).max(100).default(25)
export const mcpWebUrl = z
  .url()
  .max(4096)
  .refine((value) => {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !(url.username || url.password)
  }, 'Provide an HTTP(S) URL without embedded credentials')

/** Declare a typed tool once so discovery and invocation share exactly the same validation. */
export function defineMcpTool<Shape extends z.ZodRawShape>(
  name: string,
  description: string,
  schema: z.ZodObject<Shape>,
  handler: (input: z.output<z.ZodObject<Shape>>, signal: AbortSignal) => unknown | Promise<unknown>,
  annotations: ToolAnnotations = {}
): DesktopMcpTool {
  const strictSchema = schema.strict()
  return {
    definition: {
      name,
      description,
      inputSchema: z.toJSONSchema(strictSchema, {
        target: 'draft-7',
        io: 'input'
      }) as Tool['inputSchema'],
      outputSchema: { type: 'object', properties: { result: {} }, required: ['result'] },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
        ...annotations
      }
    },
    /** Validate before any side effect, then propagate request cancellation into the host. */
    async execute(input, signal) {
      signal.throwIfAborted()
      return await handler(strictSchema.parse(input ?? {}), signal)
    }
  }
}

/** Return stable pagination metadata alongside a bounded slice. */
export function mcpPage<T>(items: T[], offset: number, limit: number) {
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    nextOffset: offset + limit < items.length ? offset + limit : null
  }
}
