# 适用于 Visual Studio Code 的 Git Graph 插件

[English](README.md) | 中文

以图形方式查看 Git 仓库的提交历史，并直接在提交图中执行常用 Git 操作。你可以根据自己的习惯配置界面！

![Git Graph 功能演示](https://raw.githubusercontent.com/busydoggo/vscode-git-graph/main/resources/demo.gif)

## 功能

* Git Graph 视图：
    * 显示：
        * 本地分支与远程分支。
        * 本地引用，包括分支、标签和远程引用。
        * 未提交的更改。
    * 执行 Git 操作（右键点击提交、分支或标签）：
        * 创建、检出、删除、获取、合并、拉取、推送、变基、重命名和重置分支。
        * 添加、删除和推送标签。
        * 检出、拣选、丢弃和还原提交。
        * 清理、重置和储藏未提交的更改。
        * 应用储藏、从储藏创建分支、丢弃储藏，以及应用并删除储藏。
        * 查看附注标签的详细信息，包括姓名、邮箱、日期和消息。
        * 将提交哈希，以及分支、储藏和标签名称复制到剪贴板。
    * 点击提交，查看提交详情和文件更改。在提交详情视图中，你可以：
        * 点击文件更改，在 Visual Studio Code 中查看差异。
        * 打开受该提交影响的文件的当前版本。
        * 将受该提交影响的文件路径复制到剪贴板。
        * 点击提交正文中的 HTTP/HTTPS 链接，在默认浏览器中打开。
    * 点击一个提交，再按住 `CTRL/CMD` 点击另一个提交，即可比较两个提交。在提交比较视图中，你可以：
        * 点击文件更改，在 Visual Studio Code 中查看两个提交之间的差异。
        * 打开两个提交之间发生更改的文件的当前版本。
        * 将发生更改的文件路径复制到剪贴板。
    * 代码审查：记录提交详情视图和提交比较视图中已经查看过的文件。
        * 可以对任意提交或两个提交之间的差异启动代码审查，不支持未提交的更改。
        * 开始审查后，所有待审查文件会以粗体显示。查看差异或打开文件后，对应文件将不再以粗体显示。
        * 审查进度会在不同的 Visual Studio Code 会话间保留，连续 90 天没有活动的审查会自动关闭。
    * 查看未提交的更改，并将其与任意提交比较。
    * 将鼠标悬停在提交节点上，可以查看：
        * 该提交是否包含在 HEAD 的历史中。
        * 哪些分支、标签和储藏包含该提交。
    * 使用分支筛选控件选择 Git Graph 中显示的分支：
        * 显示所有分支。
        * 选择一个或多个分支。
        * 使用预先定义的分支通配符模式，通过 `vs-git-graph.customBranchGlobPatterns` 设置。
    * 从远程仓库获取更新。
    * 直接在 Description 表头中搜索提交描述，高亮匹配内容，使用上/下按钮跳转，并通过 × 清除搜索。
    * 仓库设置面板：
        * 查看、添加、编辑、删除、获取和清理远程仓库引用。
        * 配置“问题链接”，将提交消息中的问题编号转换为链接，点击后在问题跟踪系统中打开。
        * 配置“创建拉取请求”，从分支右键菜单自动打开拉取请求页面并预填信息。
            * 内置对公开托管的 Bitbucket、GitHub 和 GitLab 的支持。
            * 可以通过 `vs-git-graph.customPullRequestProviders` 配置自定义提供程序，例如私有部署的服务。配置方法见[文档](https://github.com/busydog/vscode-vs-git-graph/wiki/Configuring-a-custom-Pull-Request-Provider)。
        * 将 Git Graph 仓库配置导出为文件并提交到仓库，让同一仓库的其他使用者自动使用相同配置。
    * 键盘快捷键（在 Git Graph 视图中使用）：
        * `CTRL/CMD + F`：将焦点移至 Description 搜索框。
        * `CTRL/CMD + H`：将 HEAD 指向的提交滚动到视图中央。
        * `CTRL/CMD + R`：刷新 Git Graph 视图。
        * `CTRL/CMD + S`：滚动到已加载提交中的第一个或下一个储藏。
        * `CTRL/CMD + SHIFT + S`：滚动到已加载提交中的最后一个或上一个储藏。
        * 打开某个提交的详情后：
            * `Up` / `Down`：查看提交图中上方或下方提交的详情。
            * `CTRL/CMD + Up` / `CTRL/CMD + Down`：查看同一分支上子提交或父提交的详情。
                * 同时按住 `Shift` 时，遇到分支或合并节点会沿另一条分支导航。
        * `Enter`：提交当前打开的对话框，执行左侧的主要操作。
        * `Escape`：关闭当前对话框、右键菜单或提交详情视图。
    * 调整各列宽度，显示或隐藏 Date、Author 和 Commit 列。
    * 自动将提交消息中的常用 Emoji 短代码替换为对应表情，包括所有 [gitmoji](https://gitmoji.carloscuesta.me/)。可以通过 `vs-git-graph.customEmojiShortcodeMappings` 自定义映射。
* 提供丰富的设置，包括提交图样式、分支颜色等，详见下方“插件设置”。
* 通过状态栏入口打开 Git Graph。
* 通过命令面板中的“Git Graph: View Git Graph”打开视图。

## 插件设置

所有 Git Graph 设置的详细说明、截图、默认值和类型见[设置文档](https://github.com/busydog/vscode-vs-git-graph/wiki/Extension-Settings)。VS Code 使用简体中文界面时，插件设置的说明和下拉选项也会显示为简体中文。

主要设置如下：

* **提交详情视图（Commit Details View）**：
    * **自动居中（Auto Center）**：打开提交详情时自动将其居中。
    * **文件视图（File View）**：
        * **文件树（File Tree）**：
            * **紧凑文件夹（Compact Folders）**：将只有一个子文件夹的目录合并为一个元素显示。
        * **类型（Type）**：设置提交详情中默认使用的文件视图类型。
    * **位置（Location）**：设置提交详情视图在 Git Graph 中的显示位置。
* **右键菜单操作可见性（Context Menu Actions Visibility）**：自定义右键菜单中显示的操作，详见[文档](https://github.com/busydog/vscode-vs-git-graph/wiki/Extension-Settings#context-menu-actions-visibility)。
* **自定义分支通配符模式（Custom Branch Glob Patterns）**：设置分支筛选中可选的模式，例如 `[{"name":"Feature Requests", "glob":"heads/feature/*"}]`。
* **自定义 Emoji 短代码映射（Custom Emoji Shortcode Mappings）**：例如 `[{"shortcode": ":sparkles:", "emoji":"✨"}]`。
* **自定义拉取请求提供程序（Custom Pull Request Providers）**：配置“创建拉取请求”功能使用的自定义服务，详见[文档](https://github.com/busydog/vscode-vs-git-graph/wiki/Configuring-a-custom-Pull-Request-Provider)。
* **日期（Date）**：
    * **格式（Format）**：设置 Date 列的日期显示格式，默认使用本地时间，格式为 `YYYY/MM/DD HH:mm`，例如 `2026/10/15 20:08`。
    * **类型（Type）**：选择显示作者日期还是提交日期。
* **默认列可见性（Default Column Visibility）**：设置 Date、Author 和 Commit 列的默认显示状态，例如 `{"Date": true, "Author": true, "Commit": true}`。
* **对话框（Dialog > \*）**：设置以下对话框的默认选项：添加标签、应用储藏、拣选、创建分支、删除分支、获取到本地分支、获取远程仓库、合并、应用并删除储藏、拉取分支、变基、重置和储藏未提交的更改。
* **增强无障碍支持（Enhanced Accessibility）**：在文件更改旁显示 A/M/D/R/U 状态标记，帮助区分颜色有困难的使用者识别更改类型。未来新增的相关辅助功能也会通过此设置启用。
* **文件编码（File Encoding）**：设置读取指定版本文件时使用的字符编码，例如差异视图中的历史文件。支持的编码见[列表](https://github.com/ashtuchkin/iconv-lite/wiki/Supported-Encodings)。
* **提交图（Graph）**：
    * **颜色（Colours）**：设置提交图使用的颜色。
    * **样式（Style）**：设置提交图的连线样式。
    * **未提交的更改（Uncommitted Changes）**：设置未提交更改在图中的显示方式。
* **集成终端 Shell（Integrated Terminal Shell）**：设置 Git Graph 打开 Visual Studio Code 集成终端时使用的 Shell 路径和文件名。
* **键盘快捷键（Keyboard Shortcut > \*）**：配置 Git Graph 视图中的各项快捷键。
* **Markdown**：在提交消息和标签详情中解析并显示常用行内 Markdown 格式，包括粗体、斜体、粗斜体和行内代码。
* **仓库搜索最大深度（Max Depth Of Repo Search）**：设置在工作区中递归发现仓库时搜索子文件夹的最大深度。
* **新标签页编辑器组（Open New Tab Editor Group）**：设置查看差异、打开文件或打开指定版本文件时使用的编辑器组。
* **打开活动文档所属仓库（Open to the Repo of the Active Text Editor Document）**：打开 Git Graph 时选择当前活动文本文档所属的仓库。
* **引用标签（Reference Labels）**：
    * **对齐方式（Alignment）**：设置各提交的分支和标签引用的对齐方式。
    * **合并本地和远程分支标签（Combine Local and Remote Branch Labels）**：当本地和远程标签表示同一分支且指向同一提交时，将它们合并显示。
* **仓库（Repository）**：
    * **提交（Commits）**：
        * **获取头像（Fetch Avatars）**：获取作者和提交者的头像。
        * **初始加载数量（Initial Load）**：设置首次加载的提交数量。
        * **加载更多数量（Load More）**：设置每次手动或自动加载更多提交时的数量。
        * **自动加载更多（Load More Automatically）**：滚动到底部时自动加载更多提交。
        * **淡化显示（Mute）**：
            * **不是 HEAD 祖先的提交（Commits that are not ancestors of HEAD）**：使用较淡的文字颜色显示不属于当前检出历史的提交。
            * **合并提交（Merge Commits）**：使用较淡的文字颜色显示合并提交。
        * **顺序（Order）**：设置提交的排列顺序，详见 [git log](https://git-scm.com/docs/git-log#_commit_ordering)。
        * **显示签名状态（Show Signature Status）**：在提交详情中的提交者旁显示签名状态图标，悬停可查看详情。
    * **获取并清理（Fetch and Prune）**：获取远程更新前，删除远程仓库中已不存在的远程跟踪引用。
    * **获取并清理标签（Fetch And Prune Tags）**：获取远程更新前，删除远程仓库中已不存在的本地标签。
    * **包含 Reflog 中的提交（Include Commits Mentioned By Reflogs）**：显示仅由 Reflog 引用的提交，仅在显示所有分支时生效。
    * **加载时（On Load）**：
        * **滚动到 HEAD（Scroll To Head）**：加载仓库时自动将 HEAD 指向的提交滚动到视图中央。
        * **显示检出分支（Show Checked Out Branch）**：加载仓库时显示当前检出的分支。
        * **显示指定分支（Show Specific Branches）**：加载仓库时显示指定的分支。
    * **仅跟随第一父提交（Only Follow First Parent）**：遍历历史时只沿第一个父提交继续，详见 [--first-parent](https://git-scm.com/docs/git-log#Documentation/git-log.txt---first-parent)。
    * **显示仅被标签引用的提交（Show Commits Only Referenced By Tags）**：显示仅由标签引用的提交。
    * **显示远程分支（Show Remote Branches）**：默认显示远程分支。
    * **显示远程 HEAD（Show Remote Heads）**：显示远程 HEAD 符号引用。
    * **显示储藏（Show Stashes）**：默认显示储藏。
    * **显示标签（Show Tags）**：默认显示标签。
    * **显示未提交的更改（Show Uncommitted Changes）**：显示工作区中尚未提交的更改，大型仓库可以关闭此选项以降低负载。
    * **显示未跟踪文件（Show Untracked Files）**：在未提交更改中显示未跟踪文件，大型仓库可以关闭此选项以降低负载。
    * **签名（Sign）**：
        * **提交（Commits）**：使用 GPG 或 X.509 对提交签名。
        * **标签（Tags）**：使用 GPG 或 X.509 对标签签名。
    * **使用 Mailmap（Use Mailmap）**：显示作者和提交者的姓名、邮箱时应用 [.mailmap](https://git-scm.com/docs/git-check-mailmap#_mapping_authors) 映射。
* **仓库选择排序（Repository Dropdown Order）**：设置仓库选择列表的排序方式，仅在当前工作区包含多个仓库时显示。
* **隐藏时保留上下文（Retain Context When Hidden）**：视图不可见时保留其上下文，例如切换到其他标签页时。启用后返回 Git Graph 会更快，但会占用更多内存。
* **显示状态栏入口（Show Status Bar Item）**：在状态栏显示打开 Git Graph 的入口。
* **源代码管理集成位置（Source Code Provider Integration Location）**：设置“View Git Graph”操作在源代码管理提供程序标题中的显示位置。
* **标签页图标颜色主题（Tab Icon Colour Theme）**：设置 Git Graph 标签页图标使用的颜色主题。

插件还会读取以下 VS Code 设置：

* `git.path`：设置 Git 可执行文件的路径和文件名，可用于便携式 Git 安装。

## 插件命令

插件提供以下命令。括号内为命令面板中的名称：

* `vs-git-graph.view`：打开 Git Graph（Git Graph: View Git Graph）。
* `vs-git-graph.restart`：重启仓库发现和文件监听，并重新打开已有视图（Git Graph: Restart VSCode Git Graph）。
* `vs-git-graph.addGitRepository`：添加 Git 仓库，也可用于添加子仓库（Git Graph: Add Git Repository...）。
* `vs-git-graph.clearAvatarCache`：清除头像缓存（Git Graph: Clear Avatar Cache）。
* `vs-git-graph.endAllWorkspaceCodeReviews`：结束工作区中的所有代码审查（Git Graph: End All Code Reviews in Workspace）。
* `vs-git-graph.endSpecificWorkspaceCodeReview`：选择并结束某个代码审查，无需先打开对应视图（Git Graph: End a specific Code Review in Workspace...）。
* `vs-git-graph.fetch`：打开 Git Graph，并立即从远程仓库获取更新（Git Graph: Fetch from Remote(s)）。
* `vs-git-graph.removeGitRepository`：从 Git Graph 中移除仓库（Git Graph: Remove Git Repository...）。
* `vs-git-graph.resumeWorkspaceCodeReview`：选择并继续工作区中已有的代码审查（Git Graph: Resume a specific Code Review in Workspace...）。
* `vs-git-graph.version`：查看版本信息（Git Graph: Get Version Information）。

## 编译与打包

安装 Node.js 和 npm 后，在仓库根目录执行以下命令。

### 安装依赖

```sh
npm ci
```

此命令根据 `package-lock.json` 安装运行依赖和开发依赖。

### 编译插件

```sh
npm run compile
```

编译流程会运行 ESLint 检查、清理旧构建产物，将插件后端编译到 `out/`，并将 Webview 的 JavaScript 和 CSS 编译、合并到 `media/`。

开发时可以使用 `npm run compile-src` 单独编译后端、`npm run compile-web` 单独编译 Webview，或通过 `npm run compile-web-debug` 生成不压缩的 Webview 构建。首次编译 Webview 前，以及修改前后端共享类型后，需要先运行 `npm run compile-src`。

### 打包 VSIX

```sh
npm exec --yes --package @vscode/vsce -- vsce package
```

此命令会在需要时下载打包工具，无需全局安装。打包时会自动执行 `npm run vscode:prepublish`，进而运行完整编译流程，因此打包前无需单独编译。

生成的文件位于仓库根目录，名称为 `vs-git-graph-<version>.vsix`，版本号取自 `package.json`，例如 `vs-git-graph-1.31.1.vsix`。

如果已经安装 `vsce`，并且该命令位于 `PATH` 中，也可以运行 `npm run package`。

### 本地安装

确保 Visual Studio Code 的 `code` 命令位于 `PATH` 中，然后执行：

```sh
code --install-extension ./vs-git-graph-1.31.1.vsix --force
```

版本号变化时请替换文件名。安装完成后，在 Visual Studio Code 中执行 **Developer: Reload Window** 重新加载窗口。也可以在命令面板中执行 **Extensions: Install from VSIX...**，选择生成的文件完成安装。

## 更新日志

详细版本说明见 [CHANGELOG.md](CHANGELOG.md)。

## Visual Studio Marketplace

你可以在 [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=busydog.vs-git-graph) 安装此插件。

## 致谢

感谢所有参与 Git Graph 开发的贡献者！

Git Graph 使用了以下项目的部分图标，感谢这些项目的工作：

* [GitHub Octicons](https://octicons.github.com/)（[许可证](https://github.com/primer/octicons/blob/master/LICENSE)）
* [Icons8](https://icons8.com/icon/pack/free-icons/ios11)（[许可证](https://icons8.com/license)）
