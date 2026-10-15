### 修改临时版本

```powershell
npm version 0.2.7-test.1 --no-git-tag-version --ignore-scripts
```

然后把 [shared/constants.js](../shared/constants.js) 中的：

```javascript
export const APP_VERSION = '0.2.6';
```

改为：

```javascript
export const APP_VERSION = '0.2.7-test.1';
```

###  生成更新包

```powershell
$env:SP_PACKAGE_SCAN_USER = '0'
$env:npm_config_maxsockets = '1'
$env:npm_config_fetch_retries = '10'
$env:npm_config_fetch_retry_mintimeout = '20000'
$env:npm_config_fetch_retry_maxtimeout = '120000'

node tools/package.mjs --update `
  --from "F:\Program Files\Stronghold-Protocol" `
  --out "D:\SP-test-package" `
  --allow-dirty `
  --allow-dev `
  --keep-stage `
  --force

Remove-Item Env:SP_PACKAGE_SCAN_USER
Remove-Item Env:npm_config_maxsockets
Remove-Item Env:npm_config_fetch_retries
Remove-Item Env:npm_config_fetch_retry_mintimeout
Remove-Item Env:npm_config_fetch_retry_maxtimeout
```

###  在副本中测试

不要直接覆盖正式目录。先复制一份旧安装，再解压更新包：

```powershell
robocopy "F:\Program Files\Stronghold-Protocol" `
  "D:\SP-test-install\Stronghold-Protocol" /E

Expand-Archive `
  "D:\SP-test-package\Stronghold-Protocol-v0.2.7-test.1-update.zip" `
  -DestinationPath "D:\SP-test-install" `
  -Force
```

启动测试：

```powershell
cd "D:\SP-test-install\Stronghold-Protocol"
npm run doctor
$env:PORT = "3001"
npm start
```

###  测试完成后

- 把 `package.json`、`package-lock.json` 和 `shared/constants.js` 的临时版本改回 `0.2.6`。
- 如果只是不想继续暂存新增文件：

```powershell
git restore --staged shared/cacheGroups.js
```

- `--keep-stage` 生成的临时目录可以删除。
- npm 镜像已配置且不再需要时：

```powershell
npm config delete registry
```
