# Translation

This template should help get you started developing with Vue 3 in Vite.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
- Firefox:
  - [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  - [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## 环境变量

密钥不进源码，放 `.env.local`（已被 `.gitignore` 的 `*.local` 忽略），模板见 `.env.example`：

```sh
cp .env.example .env.local
```

目前只有一个变量 `VITE_CESIUM_ION_TOKEN`（Cesium ion 令牌）。

**注意前端没有秘密**：以 `VITE_` 开头的变量会被 Vite 内联进 `dist` 的 js，
浏览器里能直接读到（实测能在 `dist/assets/index-*.js` 里原样搜到令牌）。
所以前端 key 只能靠平台侧限制（ion 控制台给令牌设可用资产 + Allowed URLs）来收敛风险。
需要真正保密的 key（高德「Web服务」key 等）必须放后端 `Translation_BE/.env`。

## Project Setup

```sh
pnpm install
```

### Compile and Hot-Reload for Development

```sh
pnpm dev
```

### Compile and Minify for Production

```sh
pnpm build
```

构建结束后 `vite.config.js` 里的 `compressDist()` 会为文本资源额外产出 `.gz` / `.br`
（见 `dist/**/*.js.br` 等），只压文本类，图片与 glb 不压。

**部署时静态服务器必须开静态压缩**，否则这些副本不会被使用（文件本身是纯新增，不影响原有产物）：

```nginx
gzip_static on;
brotli_static on;   # 需要 ngx_brotli 模块
```

实测首屏关键 JS：`Cesium.js` 3.25MB + `index.js` 0.49MB，gzip 后 0.88MB / 0.17MB、
brotli 后 0.67MB / 0.13MB（首屏合计 3.74MB → 1.05MB / 0.80MB）。
