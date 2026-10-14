## 临时打包更新包

当前源码和 `F:\Program Files\Stronghold-Protocol` 都是 `0.2.6` 时，先把测试版本改为
`0.2.7-test.1`。如果已经改过版本，跳过这一步。

### 1. 加入新增运行时文件

打包工具只读取 `git ls-files`。已有跟踪文件可以直接用 `--allow-dirty` 带入，
只有新增文件需要加入索引：

```powershell
git add shared/cacheGroups.js
```

### 2. 修改临时版本

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

### 3. 补齐打包素材

当前源码没有完整素材时，从已有安装目录复制；如果素材已经存在，跳过这一步：

```powershell
robocopy "F:\Program Files\Stronghold-Protocol\public\assets" ".\public\assets" /E
robocopy "F:\Program Files\Stronghold-Protocol\public\fonts" ".\public\fonts" /E
Copy-Item "F:\Program Files\Stronghold-Protocol\data\local-assets.json" `
  ".\data\local-assets.json" -Force
```

### 4. 生成更新包

```powershell
node tools/package.mjs --update `
  --from "F:\Program Files\Stronghold-Protocol" `
  --out "D:\SP-test-package" `
  --allow-dirty `
  --allow-dev `
  --keep-stage `
  --force
```

生成：

```text
D:\SP-test-package\Stronghold-Protocol-v0.2.7-test.1-update.zip
```

### 5. 在副本中测试

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

### 6. 测试完成后

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
