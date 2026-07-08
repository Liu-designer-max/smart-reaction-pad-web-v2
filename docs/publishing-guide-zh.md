# GitHub 发布指南：smart-reaction-pad-web-v2

由于当前 Codex 的 GitHub connector 没有创建新仓库的权限，推荐使用 GitHub 网页发布。

## 1. 新建仓库

打开 GitHub，创建新仓库：

```text
Repository name: smart-reaction-pad-web-v2
Visibility: Public
Initialize this repository: 不勾选 README / .gitignore / license
```

目标仓库：

```text
https://github.com/Liu-designer-max/smart-reaction-pad-web-v2
```

## 2. 上传文件

进入新仓库后选择：

```text
uploading an existing file
```

把本地文件夹中的全部项目文件拖进去，但不要拖 `.git` 文件夹：

```text
D:\零碎文件\Wearable\smart-reaction-pad-web-v2
```

如果使用 zip 包，请先解压后上传里面的文件，不要直接上传 zip 文件。

## 3. 开启 GitHub Pages

进入：

```text
Settings -> Pages
```

设置：

```text
Source: Deploy from a branch
Branch: main
Folder: / root
```

保存后等待 1-3 分钟。

网页地址通常是：

```text
https://liu-designer-max.github.io/smart-reaction-pad-web-v2/
```

如果页面没有立刻更新，可以加缓存参数：

```text
https://liu-designer-max.github.io/smart-reaction-pad-web-v2/?v=2
```

## 4. 上传后验证

打开网页后应看到：

```text
Smart Reaction Pad
for Sports Rehabilitation & Return-to-Play Testing
UoD & NEU Group 1-B
```

并且 dashboard 中应包含：

```text
Stepping Response Time
Spatial Side Comparison
Response Inhibition
Performance Drift
```

不应再出现：

```text
Limb Symmetry Index
Dual-task cost
Fatigue index
Healthy baseline RT
```
