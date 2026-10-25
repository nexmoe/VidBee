# VidBee 更新日志

本页只记录你能直接感知到的更新，不展开技术实现细节。
完整发布记录请查看 [GitHub Releases](https://github.com/nexmoe/VidBee/releases)。

## [Unreleased]

## [v2.3.0](https://github.com/nexmoe/VidBee/releases/tag/v2.3.0) - 2026-10-25

### 改进与修复
- 全新安装默认开启登录时启动，并在 macOS 上隐藏 Dock 图标；两项设置均可在设置中调整。
- 略微缩小转录和 AI 回答分享图片中的文字比例，让排版更紧凑。

## [v2.2.4](https://github.com/nexmoe/VidBee/releases/tag/v2.2.4) - 2026-10-24

### 新增功能
- 可以让外部 AI 助手连接 VidBee，管理下载、订阅、转录和导出。
- 可以在 VidBee Desktop 和浏览器扩展中继续同一段 Agent 对话。
- 可以只下载字幕，无需下载视频。
- AI 图表新增 JPG 下载，并保留 SVG、PNG 和 Mermaid 源文件格式。

### 改进与修复
- 下载和转录资料库较大时保持流畅，转换后的音视频也更容易查找和切换。
- 视频加入下载队列后即可看到标题和封面。
- 扩展连接 Desktop 时，不同浏览器配置使用各自独立的登录会话。
- AI 图表在明暗主题下显示更一致，下载和查看操作保持统一。
- 修复 Intel Mac 安装包中下载工具缺失导致无法开始下载的问题。

## [v2.2.3](https://github.com/nexmoe/VidBee/releases/tag/v2.2.3) - 2026-10-11

### 改进与修复
- 编辑或移除 AI 服务商时，属于同一服务商的模型会保持分组。
- Agent 的图文回答不再在末尾附加未使用的截图。

## [v2.2.2](https://github.com/nexmoe/VidBee/releases/tag/v2.2.2) - 2026-10-11

### 改进与修复
- 修复安装版中 Agent 对话和转录提示词一开始就失败的问题。

## [v2.2.1](https://github.com/nexmoe/VidBee/releases/tag/v2.2.1) - 2026-10-11

### 改进与修复
- 恢复已发布桌面版中的账号设置。

## [v2.2.0](https://github.com/nexmoe/VidBee/releases/tag/v2.2.0) - 2026-10-11

### 新增功能
- 本地转录新增 FireRedASR v2，支持中文、英文和中文方言；也可选择更大的 Qwen3-ASR 1.7B 模型。
- 本地转录新增 Orukeet 模型。(by @Nathan-Roll1, [#480](https://github.com/nexmoe/VidBee/pull/480))
- 可以登录 VidBee 账号，在 Agent 对话中使用 Cloud 模型。
- 可以让 Agent 管理下载和订阅、转录文件，以及转换和裁剪音视频。

### 改进与修复
- 下载播放列表时可以选择视频容器格式。(by @jabrailkhalil, [#469](https://github.com/nexmoe/VidBee/pull/469))
- WebM 视频无法嵌入封面时仍会保留下载文件；订阅下载也会保留字幕文件。([#487](https://github.com/nexmoe/VidBee/pull/487), [#484](https://github.com/nexmoe/VidBee/pull/484))
- 减少账号刷新请求，在不同对话间复用可用的 Cloud 模型信息。([#495](https://github.com/nexmoe/VidBee/pull/495))
- Agent 运行期间修改的标题会保存；等待确认时暂停计时，停止回答后及时释放 Cloud 使用额度。([#495](https://github.com/nexmoe/VidBee/pull/495))
- 修改受保护的设置或删除内容前会请求确认，包括通过符号链接访问资料库之外的下载目录。([#495](https://github.com/nexmoe/VidBee/pull/495))
- Markdown 和 PDF 导出保留原始视频链接；文章截图会准确捕获所选画面，包括已缓存的画面。([#495](https://github.com/nexmoe/VidBee/pull/495))
- 合并或转换音视频时，不再因超过一分钟而误报下载超时。([#462](https://github.com/nexmoe/VidBee/issues/462), [#488](https://github.com/nexmoe/VidBee/pull/488))
- 桌面版和网页版选择格式时，会保留高分辨率 HLS 视频和不同语言的音轨。([#443](https://github.com/nexmoe/VidBee/issues/443), [#488](https://github.com/nexmoe/VidBee/pull/488))
- 删除 RSS 视频的下载记录后可重新加入队列，也支持从条目菜单复制视频链接。([#479](https://github.com/nexmoe/VidBee/issues/479), [#485](https://github.com/nexmoe/VidBee/pull/485))
- 转录前会修复或明确提示不完整的 Qwen3-ASR 模型文件；同时安装或取消模型时，不再误删其他安装任务的文件。([#473](https://github.com/nexmoe/VidBee/issues/473), [#486](https://github.com/nexmoe/VidBee/pull/486))
- 写文章时可以继续未完成的章节，并捕获相关截图。
- Agent 完成回答后会及时结束，较长的思考历史也更容易阅读。
- 分享图片和导出文档保留思考耗时与品牌页脚。
- 保存自动下载选项时，订阅的启用状态会保留。
- 本地转录前会先导入可用的平台字幕。
- 账号余额和待退还积分显示更可靠。
- 避免重复下载，包括同时提交的请求和已保存在电脑上的文件。
- 转录队列持续推进，重新加载后保留已用时间。
- 保留 Agent 的推理历史，并改进 Markdown PDF 导出。
- 已保存的文件被删除后，仍可正常移除下载记录。

## [v2.1.0](https://github.com/nexmoe/VidBee/releases/tag/v2.1.0) - 2026-08-30

### 新增功能
- 可以编辑文稿字幕：新增一行、修改文字，或一次删除一行或多行。
- 文稿现在出现在下载列表里，视频和文稿可以在同一个地方管理。
- 可以一次选中多条下载记录并批量删除。

### 改进与修复
- 下载列表可按网站筛选，并显示平台图标，更容易认出视频来源。
- 标题过长时会滚动显示，方便看清完整名称。
- 没有音轨的文件会给出明确提示，而不是静默失败。

## [v2.0.2](https://github.com/nexmoe/VidBee/releases/tag/v2.0.2) - 2026-08-23

### 改进与修复
- 修复 Windows 下打开已完成文稿时可能白屏的问题，视频与文稿现在可以正常显示和播放。(by @Autsunset)

## [v2.0.1](https://github.com/nexmoe/VidBee/releases/tag/v2.0.1) - 2026-08-23

### 新增功能
- 可在设置中选择最多五种字幕语言，也可以让字幕语言自动跟随界面语言。
- 下载过程中可以暂停并继续，无需从头重新下载。(by @Gani-SMA)

### 改进与修复
- 视频没有可用字幕时，会自动改为只下载视频，不再让整个任务失败。
- 取消下载后，即使重启应用也不会意外恢复；确认取消已保存后才会移除任务。
- 下载链接识别更稳定；网站需要浏览器 Cookie 时，提示也更清楚。
- 无需安装额外辅助工具，也能更稳定地下载更多网站的视频。
- Windows 下的视频播放与应用窗口在图形或页面异常后更容易自动恢复。
- 从托盘图标打开应用更加可靠。

## [v2.0.0](https://github.com/nexmoe/VidBee/releases/tag/v2.0.0) - 2026-08-22

1.x 下载完文件就结束了。2.0 继续往下做：在这台电脑上转录、标出谁在说话、搜索一句原话，再问 AI 做总结。

![v1.x 下载文件 vs v2.0 可搜索的本机资料库](https://github.com/nexmoe/VidBee/releases/download/v2.0.0/v2-before-after.webp)

![下载 → 本地转录 → 搜索关键词 → 问 AI 总结](https://github.com/nexmoe/VidBee/releases/download/v2.0.0/v2-workflow-grid.webp)

### 新增功能
- 新工作流：下载 → 本地转录 → 搜索关键词 → 问 AI 总结，全部在同一个应用里完成。

### 本地转录
- 可选 Whisper、SenseVoice、Parakeet、Qwen3-ASR。应用会按你的电脑和语言推荐模型。
- 语音识别在这台电脑上完成，模型下载后可以离线转录。音频不会上传到云端转录服务。
- 可导入本地音频或视频，或直接拖到文稿页，在应用内转录。

### 说话人识别
- 自动标出谁在说话，并在播放器下方显示每个人的发言时间轴。
- 也可以指定人数，只重新标注、不改已经识别出的文字。
- 点击某个说话人，跳到他的下一句。

### 搜索与时间戳
- 可搜索说过的词，或说话人名字。命中会在文稿里高亮。
- 每一行都带时间戳。点击一行（或一个词）即可从那一时刻播放。
- 可复制一段原文，或导出纯文本、Markdown、字幕。

### Ask AI
- 内置要点摘要、翻译、FAQ、思维导图、语法润色等提示词，也可以自己写。
- 可连接 OpenAI、Anthropic、Google、DeepSeek、xAI、Ollama、LM Studio，或你选择的其他服务。API 密钥保存在本机。

### 隐私
- 隐私优先：语音和文件都在本地。
- 只有在你主动运行 Ask AI 时，才会把文稿文字发给你选定的模型。想让这一步也完全本机完成，选 Ollama 或 LM Studio 即可。

### 同一版本里还有
- 切换页面时迷你播放器会继续保留。
- 下载引擎可在后台自行更新，以便继续支持更多网站。

### 改进
- 便携版不再把你选在便携目录外的自定义下载文件夹改回默认位置。
- Intel Mac 上的转写功能现在可以正常使用。
- 下载与自建部署更稳定。

## [v1.3.14](https://github.com/nexmoe/VidBee/releases/tag/v1.3.14) - 2026-07-05

### 改进与修复
- 更新下载支持，适应受支持网站的近期变化。

## [v1.3.13](https://github.com/nexmoe/VidBee/releases/tag/v1.3.13) - 2026-06-20

### 新增功能
- Windows 新增免安装版，可选择将应用数据和下载文件保存在应用旁边。(by @jabrailkhalil, [#403](https://github.com/nexmoe/VidBee/pull/403))
- 可以查看实时下载日志，并从下载历史中重新打开日志。

### 改进与修复
- 粘贴播放列表或 YouTube 频道链接时，会自动打开播放列表下载选项。
- 更换链接后，不再误下载此前选中的视频。
- 在 Windows 上取消下载时会彻底停止任务，Firefox 浏览器 Cookie 的识别也更可靠。
- Twitch 的可选字幕不可用时仍会继续下载；首选音视频组合缺失时，会尝试可用格式。
- 修复 Linux Debian 安装包安装后无法启动的问题。

## [v1.3.12](https://github.com/nexmoe/VidBee/releases/tag/v1.3.12) - 2026-06-20

### 新增功能
- 可以在“关于”中选择稳定版或预览版更新，并持续接收所选通道的更新。

## [v1.3.11](https://github.com/nexmoe/VidBee/releases/tag/v1.3.11) - 2026-06-19

### 新增功能
- 一键下载可选择 MP4、MKV、WebM 或原始格式。
- 按 Ctrl+V 或 Cmd+V 可用复制的链接打开添加下载窗口。

### 改进与修复
- 下载需要浏览器 Cookie、登录或可用网络时，会提供更清楚的操作指引。
- 修复长时间下载或大型播放列表导致应用崩溃的问题。
- 恢复部分旧版 1.3 安装的正常启动，改善 macOS 上下载工具的识别。
- 更新下载支持，适应受支持网站的近期变化。

## [v1.3.10](https://github.com/nexmoe/VidBee/releases/tag/v1.3.10) - 2026-04-11
### 改进
- 首次使用默认开启一键下载，开始下载更快。
- 下载列表标题左对齐，阅读更清晰。

## [v1.3.9](https://github.com/nexmoe/VidBee/releases/tag/v1.3.9) - 2026-04-11
### 改进
- 自定义 FFmpeg 路径更简单：可填写可执行文件路径，或其所在文件夹。
- 订阅源检查失败或异常时，提示更清晰易懂。
- 下载过程中的状态与提示更易理解，便于排查或重试。
- macOS 与 Linux 下过长文件名会自动截断，与 Windows 行为一致。
- 在支持的界面中，可使用快捷键更快添加下载链接。

## [v1.3.8](https://github.com/nexmoe/VidBee/releases/tag/v1.3.8) - 2026-04-06
### Bug 修复
- 强化数据库迁移，旧版本安装升级更可靠。
- FFmpeg 等可选工具缺失或初始化失败时，不再阻塞应用启动。
- 订阅检查在遇到常见网络或订阅源格式问题时，减少无效错误上报。

### 改进
- 优化 GlitchTip 反馈与错误上报细节。

## [v1.3.7](https://github.com/nexmoe/VidBee/releases/tag/v1.3.7) - 2026-03-29
### Bug 修复
- 改进文件名清理逻辑，正确处理特殊 Unicode 字符和控制符。
- Windows 下载现在会自动截断过长的文件名。
- 修改并发下载数限制后立即生效，无需重启。

## [v1.3.6](https://github.com/nexmoe/VidBee/releases/tag/v1.3.6) - 2026-03-29

### 新功能
- 集成 GlitchTip 错误上报与用户反馈支持
- 新增版本过期更新提醒通知
- 集成 Rybbit 分析
- 优化下载界面细节

## [v1.3.5](https://github.com/nexmoe/VidBee/releases/tag/v1.3.5) - 2026-03-18

### 改进与修复
- 更新下载支持，适应受支持网站的近期变化。

## [v1.3.4](https://github.com/nexmoe/VidBee/releases/tag/v1.3.4) - 2026-03-14
### Bug 修复
- 改用 Electron 默认下载源进行打包，提升 macOS 发布构建的稳定性。

## [v1.3.3](https://github.com/nexmoe/VidBee/releases/tag/v1.3.3) - 2026-03-14
### 需求更新
- 优化了发布流程，preview 测试版现在可以独立于正式更新通知发布。

### Bug 修复
- 恢复 Electron 打包时的 npm rebuild，原生依赖在发布构建中的准备过程会更可靠。
- 进一步改善桌面端构建打包，让共享工作区依赖在发布版本中更稳定地被正确包含。

## [v1.3.3-preview.1](https://github.com/nexmoe/VidBee/releases/tag/v1.3.3-preview.1) - 2026-03-14
### Bug 修复
- 恢复 Electron 打包时的 npm rebuild，原生依赖在发布构建中的准备过程会更可靠。

## [v1.3.3-preview.0](https://github.com/nexmoe/VidBee/releases/tag/v1.3.3-preview.0) - 2026-03-14
### 需求更新
- 新增 preview 发布通道，测试版可独立发布且不会触发正式站点更新通知。

### Bug 修复
- 进一步改善桌面端构建打包，让共享工作区依赖在发布版本中更稳定地被正确包含。

## [v1.3.2](https://github.com/nexmoe/VidBee/releases/tag/v1.3.2) - 2026-03-14
### Bug 修复
- 提升了桌面端打包稳定性，让共享下载组件在发布版本中更稳定地被正确包含。

## [v1.3.1](https://github.com/nexmoe/VidBee/releases/tag/v1.3.1) - 2026-03-14
### 需求更新
- 新增 Web 与 API 版本，并与桌面端共享下载核心能力和主要设置行为。
- 设置页新增上传 Cookie 与配置文件的能力。
- 下载历史迁移到 SQLite 存储，可靠性和跨端一致性更好。
- 下载弹窗新增统一的添加链接交互，并优化深色主题下滑块可见性。

### Bug 修复
- 提升了桌面端内置二进制初始化流程的稳定性与诊断信息质量。
- 修复了设置页资料输入框光标跳动问题。
- 修复了 Linux 下选择非空目录作为下载目录时的校验问题。
- 优化了本地化一致性，修正了部分中文翻译问题。

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
