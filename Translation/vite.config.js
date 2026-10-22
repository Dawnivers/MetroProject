import { fileURLToPath, URL } from 'node:url'
import { join, extname, resolve } from 'node:path'
import { readdir, readFile, writeFile, stat as fsStat } from 'node:fs/promises'
import { gzipSync, brotliCompressSync, constants as zlib } from 'node:zlib'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import cesium from 'vite-plugin-cesium'

/**
 * 产物预压缩：为 dist 里的文本资源额外生成 `.gz` / `.br` 副本。
 *
 * 为什么不用 vite-plugin-compression：本项目 node_modules 由 pnpm 10.33 安装（store v10），
 * 而会话里的 pnpm 是 11（store v11，格式不兼容），add 一个包很可能被判定「必须重建
 * node_modules」而整包联网重装。node:zlib 足够，零依赖。
 *
 * 只压文本类（js/css/html/json/svg/wasm…）。.jpg/.png/.glb/.woff2 本身已压缩，
 * 再压体积基本不降、白费时间。小于 1KB 的不压，省得产物里全是几十字节的碎片文件。
 *
 * 生效前提：静态服务器要开着静态压缩，nginx 是
 *   gzip_static on;  brotli_static on;
 * 没有这句，服务器只会当成普通文件发出去（.gz 文件是纯新增，不影响原有产物）。
 */
function compressDist() {
  const COMPRESSIBLE = new Set([
    '.js', '.mjs', '.css', '.html', '.json', '.svg', '.txt', '.xml', '.wasm',
  ])
  const MIN_BYTES = 1024
  let outDir = 'dist'

  return {
    name: 'compress-dist',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    // 放在 closeBundle：vite-plugin-cesium 也是在 closeBundle 里把 371 个 Cesium 文件
    // 拷进 dist/cesium，本插件在数组里排最后，才能连 Cesium.js 一起压。
    async closeBundle() {
      const targets = []
      async function walk(dir) {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name)
          if (entry.isDirectory()) {
            await walk(path)
            continue
          }
          if (!entry.isFile() || !COMPRESSIBLE.has(extname(entry.name))) continue
          const size = (await fsStat(path)).size
          if (size >= MIN_BYTES) targets.push({ path, size })
        }
      }

      const t0 = Date.now()
      await walk(outDir)

      let gzBytes = 0
      let brBytes = 0
      let rawBytes = 0
      for (const { path, size } of targets) {
        const raw = await readFile(path)
        const gz = gzipSync(raw, { level: 9 })
        const br = brotliCompressSync(raw, {
          params: { [zlib.BROTLI_PARAM_QUALITY]: 11 },
        })
        await writeFile(path + '.gz', gz)
        await writeFile(path + '.br', br)
        rawBytes += size
        gzBytes += gz.length
        brBytes += br.length
      }

      const mb = (n) => (n / 1024 / 1024).toFixed(2)
      console.log(
        `[compress-dist] ${targets.length} 个文件 · ${mb(rawBytes)}MB → ` +
          `gzip ${mb(gzBytes)}MB (${((gzBytes / rawBytes) * 100).toFixed(0)}%) · ` +
          `brotli ${mb(brBytes)}MB (${((brBytes / rawBytes) * 100).toFixed(0)}%) · ` +
          `${((Date.now() - t0) / 1000).toFixed(1)}s`,
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    cesium(),
    compressDist(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    watch: {
      // 编辑器/工具做「原子保存」时，会先在源码目录里落一个 .*.tmpdir/ + *.tmp 临时文件
      // 再改名替换。Windows 上 watcher 去 watch 这些马上要被删除的文件会抛 EBUSY，
      // 而且是未捕获错误——dev server 会直接退出（本机实测过一次）。
      // 把这类临时文件排除掉，避免开发服务器被一次保存搞崩。
      ignored: ['**/.*.tmpdir/**', '**/.*.tmp', '**/*.tmp'],
    },
  },
})
