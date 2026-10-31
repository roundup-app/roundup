// Writes dist/search.json: one entry per page section, from the .md twins vitepress-plugin-llms emits.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dist = new URL('.vitepress/dist/', import.meta.url).pathname

const base = '/roundup/'

const sections = readdirSync(dist)
  .filter((f) => f.endsWith('.md') && f !== 'llms-full.md')
  .flatMap((file) => {
    const url = base + (file === 'index.md' ? '' : file.replace(/\.md$/, ''))
    const body = readFileSync(join(dist, file), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '')

    return body
      .split(/^(?=#{1,6} )/m)
      .filter((s) => s.trim())
      .map((markdown) => {
        const heading = /^#{1,6} (.*)/.exec(markdown)?.[1] ?? ''
        const text = markdown.replace(/^#{1,6} .*\n/, '').replace(/[`*_>#-]/g, '').replace(/\s+/g, ' ').trim()

        return { url, heading, markdown: markdown.trim(), text }
      })
  })

writeFileSync(join(dist, 'search.json'), JSON.stringify(sections))
