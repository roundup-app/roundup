import { defineConfig } from 'vitepress'
import llmstxt from 'vitepress-plugin-llms'

const pages = [
  ['Install', 'install'],
  ['Concepts', 'concepts'],
  ['Projects and Workstreams', 'projects-and-workstreams'],
  ['Agents', 'agents'],
  ['Terminals', 'terminals'],
  ['Todos', 'todos'],
  ['Pads', 'pads'],
  ['Messages', 'messages'],
  ['Inbox and Needs you', 'inbox-and-needs-you'],
  ['Keyboard', 'keyboard'],
  ['Settings', 'settings'],
  ['`rup` CLI', 'rup-cli'],
  ['MCP tools', 'mcp-tools'],
  ['Status code (OSC 7501)', 'status-code'],
  ['Privacy', 'privacy'],
] as const

export default defineConfig({
  title: 'roundup',
  description: 'Documentation for roundup',
  base: '/roundup/',
  cleanUrls: true,
  srcExclude: ['README.md'],
  themeConfig: {
    search: { provider: 'local' },
    sidebar: pages.map(([text, slug]) => ({ text, link: `/${slug}` })),
  },
  vite: {
    plugins: [llmstxt({ domain: 'https://roundup-app.github.io' })],
  },
})
