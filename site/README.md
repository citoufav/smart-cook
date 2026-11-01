# 落地页（site/）

一个单文件静态页：`index.html` + `assets/`。没有构建步骤、没有依赖，双击就能看。

## 改下载源

`index.html` 里只有两处放着一模一样的 APK 地址：

- 顶部 `<script>const APK_URL = "..."</script>`
- 下载按钮的 `href="..."`

改成镜像直链即可（例如 Gitee 的 release 附件地址）。两处一起改，否则关掉 JS 的用户会拿到旧链接。

## 部署方式

### Gitee（国内直链，需要实名）

1. 在 Gitee 新建仓库，把本仓库推一份过去：
   ```bash
   git remote add gitee git@gitee.com:<用户名>/smart-cook.git
   git push gitee master --tags
   ```
2. 在该仓库的「发行版」里新建 `v1.0.1`，把 `dist/suizhu-1.0.1-android.apk` 作为附件上传。
3. 拿到附件直链（形如 `https://gitee.com/<用户名>/smart-cook/releases/download/v1.0.1/suizhu-1.0.1-android.apk`），按上面「改下载源」替换两处地址。

Gitee Pages（静态页托管）对新用户不一定开放，能开通就把 `site/` 传上去；开不通就只把 Gitee 当**下载源**，页面另找地方托管。

### Cloudflare Pages（免费，不需要实名）

1. 用邮箱注册 Cloudflare，进 Dashboard → Workers & Pages → Pages → 上传资源。
2. 把整个 `site/` 目录拖进去，得到 `xxx.pages.dev` 链接。
3. APK 不要放进 Pages：单文件上限 25 MiB，而这个包 27.6 MB。继续用 GitHub Release 或 Gitee 的附件地址（改上面那两处）。

### 任意静态托管

纯静态、无请求，丢到任何支持 https 的地方都能跑。

## 上线前检查

- 下载按钮点一次，确认拿到的是 `.apk` 而不是 404 页面
- 手机竖屏看一眼：截图那一排应该能横向滑动
- 页面上不出现真实 API Key、真实邮箱、真实用户数据
