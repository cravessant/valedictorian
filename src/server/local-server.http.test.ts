import type http from 'node:http'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { readJsonBody } from './local-server.http'

describe('local server JSON body reader', () => {
  it('rejects chunked streaming overflow at a low limit while discarding later input', async () => {
    const stream = new PassThrough()
    const request = Object.assign(stream, { headers: {} }) as unknown as http.IncomingMessage
    const result = readJsonBody(request, {
      maxBytes: 5,
      maxBytesMessage: 'Synthetic streaming limit exceeded',
    })

    stream.write(Buffer.from('1234'))
    stream.write(Buffer.from('5678'))
    stream.end(Buffer.from('discarded-after-overflow'))

    await expect(result).rejects.toMatchObject({
      message: 'Synthetic streaming limit exceeded',
      statusCode: 413,
    })
  })
})
