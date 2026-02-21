# VidBee 更新日志

本页只记录你能直接感知到的更新，不展开技术实现细节。
完整发布记录请查看 [GitHub Releases](https://github.com/nexmoe/VidBee/releases)。

## [v1.3.0](https://github.com/nexmoe/VidBee/releases/tag/v1.3.0) - 2026-02-15
### 需求更新
- 新增更快捷的一键操作，粘贴链接后可更快开始下载。
- 新增法语、俄语与土耳其语界面本地化支持。
- 完善了土耳其语托盘菜单的本地化。
- 将 Cookie 设置重构为三个更清晰的分组。
- 在 RSS 文档中新增 RSSHub 门户链接。

### Bug 修复
- 提升了 YouTube 与格式回退场景下的下载兼容性。
- 下载输出会更稳定地遵循你选择的容器格式。
- 设置页与文档体验持续优化，问题反馈与 RSS 指引更清晰。
- 新增当请求格式不可用时的下载回退处理。
- 补齐了土耳其语缺失的本地化键。
- 通过检查与工作流修复提升了发布流程稳定性。

## [v1.2.4](https://github.com/nexmoe/VidBee/releases/tag/v1.2.4) - 2026-01-24
### 需求更新
- 一键下载流程更直接，操作步骤更短。
- 设置页新增 Cookie 管理标签，账号相关操作更集中。
- 常见问题入口更明显，报错提示更容易理解。

### Bug 修复
- RSS 使用说明更清晰，新用户上手更快。

## [v1.2.3](https://github.com/nexmoe/VidBee/releases/tag/v1.2.3) - 2026-01-23
### 需求更新
- Cookie 使用指引补充了更直观的示例。

### Bug 修复
- 播放列表加载更稳定，不再出现界面挤压问题。

## [v1.2.2](https://github.com/nexmoe/VidBee/releases/tag/v1.2.2) - 2026-01-21
### 需求更新
- 下载相关操作入口更顺手。
- 新增分享时的水印开关选择。
- 整体下载操作的一致性更好。

## [v1.2.1](https://github.com/nexmoe/VidBee/releases/tag/v1.2.1) - 2026-01-20
### 需求更新
- 播放列表内重名内容更容易区分。
- 排查问题时更容易找到日志和相关文件。
- 订阅相关链接和指引更加可靠。
- 文档站点能力进一步完善，新增 i18n 支持、站点地图与协议文档。

### Bug 修复
- 下载过程中的提示更克制，减少打扰。
- 修复了文档项目中的 TypeScript 构建问题。

## [v1.2.0](https://github.com/nexmoe/VidBee/releases/tag/v1.2.0) - 2026-01-17
### 需求更新
- 支持更快捷地全选和清空下载历史。
- 订阅使用中重复内容更少。
- 播放列表与设置页面更易用。
- 默认改为最小化到系统托盘。
- 反馈流程会在 GitHub Issue 链接过长时给出提醒。

### Bug 修复
- 最小化和重新打开应用时体验更顺滑。
- 下载中断后的继续体验更稳定。
- 更可靠地限制播放列表区域高度。
- 问题反馈链接结构更简洁稳定。
- 增加了更清晰的 Windows 专用 Cookie 说明。
- 强化了 ffmpeg/ffprobe 资源目录检查。

## [v1.1.12](https://github.com/nexmoe/VidBee/releases/tag/v1.1.12) - 2026-01-15
### 需求更新
- 提交反馈时可提供的信息更清楚。

### Bug 修复
- 设置项对下载目录选择的行为更符合预期。

## [v1.1.11](https://github.com/nexmoe/VidBee/releases/tag/v1.1.11) - 2026-01-14
### 需求更新
- 订阅页面浏览体验更流畅。
- 错误提示提供了更明确的下一步建议。
- 默认设置更适合日常使用。
- 扩展错误页与品牌展示进一步优化。
- 下载错误面板提供了更丰富的排查链接。
- 订阅标签页支持横向滚动。

### Bug 修复
- 下载流程与页面布局更清晰。
- 增加了 Bilibili 字幕嵌入失败保护。
- 补齐了缺失的本地化翻译条目。
- 默认关闭了更容易引发问题的嵌入缩略图行为。

## [v1.1.10](https://github.com/nexmoe/VidBee/releases/tag/v1.1.10) - 2026-01-12
### Bug 修复
- macOS 的安装和更新体验更稳定。
- 在 macOS 构建中增加了捆绑工具签名流程。
- 在 CI 中完善了 DMG 公证流程，发布可靠性更高。

## [v1.1.8](https://github.com/nexmoe/VidBee/releases/tag/v1.1.8) - 2026-01-12
### 需求更新
- 下载进度信息更直观。

### Bug 修复
- 更新提示的本地化显示更清晰。

## [v1.1.7](https://github.com/nexmoe/VidBee/releases/tag/v1.1.7) - 2026-01-11
### 需求更新
- 新增更多媒体输出偏好设置。
- 首次配置和日常使用流程更顺畅。

## [v1.1.6](https://github.com/nexmoe/VidBee/releases/tag/v1.1.6) - 2026-01-11
### 需求更新
- 本地视频信息相关流程更顺手。

### Bug 修复
- Cookie 配置管理更稳定、可预期。

## [v1.1.5](https://github.com/nexmoe/VidBee/releases/tag/v1.1.5) - 2026-01-10
### Bug 修复
- 高级设置页的已知问题得到修复。
- 远程封面加载稳定性更好。
- 订阅封面选择更可靠。

## [v1.1.4](https://github.com/nexmoe/VidBee/releases/tag/v1.1.4) - 2026-01-09
### 需求更新
- 开机自启后的窗口行为更自然。

### Bug 修复
- 设置页整体行为更一致。

## [v1.1.3](https://github.com/nexmoe/VidBee/releases/tag/v1.1.3) - 2026-01-02
### 需求更新
- 关于页面更容易看到更新状态。

### Bug 修复
- 下载格式选择在更多场景下更稳定。

## [v1.1.2](https://github.com/nexmoe/VidBee/releases/tag/v1.1.2) - 2025-12-26
### 需求更新
- 恢复了更多站点的下载可用性。
- 问题反馈流程更简洁。
- 新增 Issue 模板并简化了 Bug 报告表单。

### Bug 修复
- 强化了 CI 下载步骤的稳定性。

## [v1.1.1](https://github.com/nexmoe/VidBee/releases/tag/v1.1.1) - 2025-12-26
### 需求更新
- 更新提示更克制，不打断当前操作。
- 关于页面文案与链接更清楚。
- 增加了 yt-dlp 集成所需的 JavaScript 运行时支持。
- 高级选项面板的动效过渡更顺滑。

### Bug 修复
- 下载相关面板交互更顺滑。
- 为了统一体验与体积控制，Electron 语言资源默认限制为英文。

## [v1.1.0](https://github.com/nexmoe/VidBee/releases/tag/v1.1.0) - 2025-12-20
### 需求更新
- 支持批量管理下载历史，清理更高效。
- 支持自定义下载目录。
- RSS 设置弹窗更容易理解和填写。

### Bug 修复
- 打开下载任务链接时行为更符合预期。

## [v1.0.2](https://github.com/nexmoe/VidBee/releases/tag/v1.0.2) - 2025-12-06
### Bug 修复
- 增加更多兼容选项，适配场景更广。
- 路径填写容错更好，日常使用更省心。

## [v1.0.1](https://github.com/nexmoe/VidBee/releases/tag/v1.0.1) - 2025-11-16
### 需求更新
- 新增开机自启动支持。
- 语言支持进一步完善。

## [v1.0.0](https://github.com/nexmoe/VidBee/releases/tag/v1.0.0) - 2025-11-15
### 需求更新
- VidBee 首个主版本发布。
- 新增 RSS 订阅下载能力。
- 历史记录与媒体预览体验得到加强。
- 支持站点列表新增站点图标展示。
- 增强了媒体预览远程图片加载与缓存能力。
- 侧边栏拖拽与标题栏交互行为更合理。

### Bug 修复
- 导航结构和整体界面体验更清晰。
- 历史记录存储迁移到 SQLite（Drizzle），数据处理更可靠。

## [v0.3.5](https://github.com/nexmoe/VidBee/releases/tag/v0.3.5) - 2025-11-08
### 需求更新
- 一键下载文案和反馈提示更易懂。
- 视觉风格更统一。

## [v0.3.4](https://github.com/nexmoe/VidBee/releases/tag/v0.3.4) - 2025-11-03
### Bug 修复
- 更新提示与下载选项展示更清晰。

## [v0.3.3](https://github.com/nexmoe/VidBee/releases/tag/v0.3.3) - 2025-11-02
### Bug 修复
- 更多场景下的下载处理稳定性得到提升。

## [v0.3.2](https://github.com/nexmoe/VidBee/releases/tag/v0.3.2) - 2025-10-31
### Bug 修复
- 多设备分发体验进一步优化。

## [v0.3.1](https://github.com/nexmoe/VidBee/releases/tag/v0.3.1) - 2025-10-30
### 需求更新
- Linux 使用体验更友好。
- 新增版本更新提醒，方便及时升级。

## [v0.3.0](https://github.com/nexmoe/VidBee/releases/tag/v0.3.0) - 2025-10-29
### 需求更新
- 新增播放列表下载支持。

### Bug 修复
- 增加减少桌面打扰的相关控制项。

## [v0.2.2](https://github.com/nexmoe/VidBee/releases/tag/v0.2.2) - 2025-10-27
### 需求更新
- 预览阶段的持续体验打磨。

## [v0.2.1](https://github.com/nexmoe/VidBee/releases/tag/v0.2.1) - 2025-10-26
### 需求更新
- 预览阶段的持续体验打磨。

## [v0.2.0](https://github.com/nexmoe/VidBee/releases/tag/v0.2.0) - 2025-10-25
### 需求更新
- 预览阶段的持续体验打磨。

## [v0.1.8](https://github.com/nexmoe/VidBee/releases/tag/v0.1.8) - 2025-10-24
### 需求更新
- 公开预览期开始。

## [v0.1.7](https://github.com/nexmoe/VidBee/releases/tag/v0.1.7) - 2025-10-24
### 需求更新
- 新增自动更新支持，并完善了文档中的发布说明。
- 完善项目文档，包括截图与贡献指南。

### Bug 修复
- 简化下载路径处理逻辑，移除了未使用的输出路径逻辑。

## [v0.1.6](https://github.com/nexmoe/VidBee/releases/tag/v0.1.6) - 2025-10-23
### Bug 修复
- 移除了发布流程中不必要的目录创建步骤。

## [v0.1.5](https://github.com/nexmoe/VidBee/releases/tag/v0.1.5) - 2025-10-23
### Bug 修复
- 优化发布流程：支持在跨平台打包时下载 yt-dlp 二进制文件。

## [v0.1.4](https://github.com/nexmoe/VidBee/releases/tag/v0.1.4) - 2025-10-23
### Bug 修复
- 调整发布流程为仅构建 Windows 目标。

## [v0.1.3](https://github.com/nexmoe/VidBee/releases/tag/v0.1.3) - 2025-10-23
### Bug 修复
- 简化 CI 中的发布构建步骤与产物处理流程。
- 调整 CI 触发条件：仅在 `main` 分支运行 Pull Request 自动化流程。

## [v0.1.2](https://github.com/nexmoe/VidBee/releases/tag/v0.1.2) - 2025-10-23
### Bug 修复
- 为发布流程中的构建步骤显式指定 shell，提升执行稳定性。

## [v0.1.1](https://github.com/nexmoe/VidBee/releases/tag/v0.1.1) - 2025-10-23
### 需求更新
- 早期迭代版本，未记录新增用户可见改动。

## [v0.1.0](https://github.com/nexmoe/VidBee/releases/tag/v0.1.0) - 2025-10-23
### 需求更新
- 初始公开发布基线版本。
