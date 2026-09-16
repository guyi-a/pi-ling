---
name: bosszp
description: Boss 直聘岗位搜索的完整操作手册。触发场景：用户说"找工作"/"看岗位"/"搜招聘"/"投简历"/"跳槽"/"Boss 直聘"/"看看有什么工作"/"帮我看下 XX 岗位"等。前提：必须走 browser_bridge（Boss 需要用户 Chrome 登录态；browser_use 独立环境登不上）。包含 URL 模板、城市编码表、Vue data 抽取 JS（绕字体反爬）、登录检查、滚动加载策略、返回格式。
---

# Skill: bosszp（Boss 直聘岗位搜索）

用 `browser_bridge` 打开用户 Chrome，在 Boss 直聘上按关键词 + 城市搜岗位，用一段特殊 JS 从页面 Vue 组件里读明文数据，返回结构化列表。

## 决策优先级

- **只走 browser_bridge**，不用 browser_use（Boss 需要登录态，use 是独立环境登不上）
- 先 `browser_bridge(action='extension_status')`；`ready=false` 立刻停下告诉上游"用户没装 Kro Browser Bridge 扩展"
- 已连接的 browser_id 从 `list_sessions` 拿

## 工作流

### 1. 前提检查
```
browser_bridge(action='extension_status')      // ready 必须 true
browser_bridge(action='list_sessions')         // 拿 browser_id
browser_bridge(action='list_pages', browser_id=...) // 找已打开的 zhipin.com tab
```

### 2. 登录检查（分两级）

**未登录也能查到部分岗位**，但结果稀少且没薪资/HR 信息 —— 不算合格结果。**必须要求用户先登录再继续**。

#### 2.1 快速判断（**先做这一步**）

`list_pages` 返回的每个 page 都带 `url` 和 `title`。**先看这两个**，命中任一条就是未登录，**直接停下**，**不要**跑 execute_script：

- URL 包含 `/web/user/`（Boss 未登录时会重定向到这里，包括 `/web/user`、`/web/user/`、`/web/user/login` 等）
- URL 包含 `/account/login`
- title 包含"登录"或"注册"（比如 `【BOSS直聘注册登录】...`）
- title 包含"未登录"

#### 2.2 深度检查（快速判断没命中时才用）

只有当 URL/title 看起来是正常岗位页（`/web/geek/job` 等）时，才 execute_script 二次确认。**下面这条已经压成单行**（execute_script 有换行会静默返 null，见下面硬约束）：

```js
(function(){var url=window.location.href;var title=document.title||'';var isLoginPage=url.indexOf('/web/user')!==-1||url.indexOf('/account/login')!==-1||title.indexOf('登录')!==-1||title.indexOf('注册')!==-1;var userNameEl=document.querySelector('.nav-figure img, .user-nav .name, .geek-nav .name, [class*=user-name], [class*=userName]');var userName='';if(userNameEl){userName=(userNameEl.alt||userNameEl.getAttribute('title')||userNameEl.textContent||'').trim();}var links=document.querySelectorAll('a');var hasLoginLink=false;for(var i=0;i<links.length;i++){var h=links[i].getAttribute('href')||'';if(h.indexOf('user/login')!==-1||h.indexOf('user/register')!==-1){hasLoginLink=true;break;}}return JSON.stringify({is_login_page:isLoginPage,is_logged_in:!!userName||(!hasLoginLink&&!isLoginPage),user_name:userName,has_login_link:hasLoginLink});})()
```

改动要点：登录链接检测原来用 `a[href*="user/login"]`（有嵌套引号，不稳定），改成 `document.querySelectorAll('a')` + JS 里遍历 `href` 字符串匹配，完全没有嵌套引号。

#### 判定与返回

`is_logged_in=false`、返回 `value=null`、或 2.1 命中登录页 → **立刻停下**，返回给上游：

```
用户在 Boss 直聘上未登录，无法进行完整搜索。请用户在 Chrome 里打开 https://www.zhipin.com/ 完成登录后重试。
```

**不要**：
- 明明 URL 已经是登录页还去跑 execute_script（浪费一步）
- 未登录状态下继续抓取（结果不全，浪费一次尝试）
- 尝试猜密码或替用户点登录
- 犹豫"要不要试试看能拿多少" —— 一律停下

### 3. URL 直拼（免搜索框交互）

```
https://www.zhipin.com/web/geek/job?query={keyword}&city={city_code}
```

用 `open_tab` 直接跳到目标 URL。

### 4. 城市编码表

| 城市 | code | | 城市 | code | | 城市 | code |
|---|---|---|---|---|---|---|---|
| 全国 | 100010000 || 北京 | 101010100 || 上海 | 101020100 |
| 广州 | 101280100 || 深圳 | 101280600 || 杭州 | 101210100 |
| 成都 | 101270100 || 南京 | 101190100 || 武汉 | 101200100 |
| 西安 | 101110100 || 苏州 | 101190400 || 长沙 | 101250100 |
| 郑州 | 101180100 || 重庆 | 101040100 || 天津 | 101030100 |
| 合肥 | 101220100 || 青岛 | 101120200 || 厦门 | 101230200 |
| 东莞 | 101281600 || 大连 | 101070200 || 佛山 | 101280800 |
| 福州 | 101230100 || 济南 | 101120100 || 昆明 | 101290100 |
| 宁波 | 101210400 || 无锡 | 101190200 || 珠海 | 101280700 |
| 沈阳 | 101070100 || 哈尔滨 | 101050100 || 长春 | 101060100 |

不在表里的、海外城市 → 用"全国"（100010000）兜底。

### 5. 等页面加载 + 滚动扩容

`open_tab` 后：

1. `wait_for(timeout_ms=8000)` — 等基础渲染
2. execute_script 数当前卡数：
   ```js
   (function(){ return document.querySelectorAll('.job-card-wrap').length; })()
   ```
3. 卡数 > 0 才继续，否则再等 1-2 秒重数（Boss SSR + 客户端渲染慢）
4. 循环扩容（最多 5 轮）：
   - `scroll(y=3000)` 触发懒加载
   - 重新数卡
   - 卡数 ≥ 30 或**跟上一轮相同** → 停止扩容

### 6. 提取岗位数据（**分两步、限量**）

Boss 用 CSS `@font-face` 混淆部分数字字段（薪资等），但**大多数关键信息（岗位名、公司名、城市、要求）在 DOM 里是明文**。

#### 6.1 先探测有多少岗位卡

一定要**先跑这一步**确认卡片存在，再跑抽取。

```js
(function(){ return document.querySelectorAll('.job-card-wrap').length; })()
```

返回数字才能进下一步。返回 null → wait_for 一下重试；仍 null 停下报告。

#### 6.2 首选：Vue data 抽取（明文薪资，绕字体反爬）

Boss 用 `@font-face` 字体反爬 DOM 里的薪资数字，但 **Vue 组件挂在 DOM 上的 `__vue__` expando 属性可以读**（在 content script isolated world 也能读，因为它是 DOM 元素属性，不是 window 全局）。`$data.jobList` 里的 `salaryDesc` 是**明文** `"15-25K"`。

**先跑这条**（默认取 10 个，agent 要 N 个就改 `slice(0,10)` 里的数字）：

```js
(function(){function findJobList(vm,depth){if(depth>8)return null;var d=vm.$data||{};if(d.jobList&&Array.isArray(d.jobList)&&d.jobList.length>0)return d.jobList;var children=vm.$children||[];for(var j=0;j<children.length;j++){var r=findJobList(children[j],depth+1);if(r)return r;}return null;}var el=document.querySelector('#wrap');if(!el||!el.__vue__)return JSON.stringify({count:0,jobs:[],source:'vue_unavailable'});var list=findJobList(el.__vue__,0);if(!list)return JSON.stringify({count:0,jobs:[],source:'vue_no_list'});var slice=list.slice(0,10);var jobs=slice.map(function(item){return {title:item.jobName||'',salary:item.salaryDesc||'',company:item.brandName||'',area:(item.cityName||'')+(item.areaDistrict?' '+item.areaDistrict:'')+(item.businessDistrict?' '+item.businessDistrict:''),experience:item.jobExperience||'',education:item.jobDegree||'',tags:item.skills||[],company_tags:[item.brandStageName||'',item.brandScaleName||'',item.brandIndustry||''].filter(function(x){return x;}),hr:item.bossName||'',url:'https://www.zhipin.com/job_detail/'+item.encryptJobId+'.html',welfare:item.welfareList||[]};});return JSON.stringify({count:jobs.length,jobs:jobs,source:'vue_data'});})()
```

返回体的 `source` 字段：
- `vue_data` → **成功**，`jobs[].salary` 是明文，直接用
- `vue_unavailable` / `vue_no_list` → Vue 挂载点变了或页面还没渲染完 → 跑 6.3 DOM 回退

#### 6.3 回退：DOM 抽取（薪资可能字体反爬）

Vue 路径失败时才用。DOM 里的薪资经常是乱码字符（`-K·薪`），其它字段（title / company / area / tags）一般明文：

```js
(function(){var items=Array.prototype.slice.call(document.querySelectorAll('.job-card-wrap'),0,10);var jobs=[];for(var i=0;i<items.length;i++){var item=items[i];var titleEl=item.querySelector('.job-name, [class*=job-title]');var salaryEl=item.querySelector('.job-salary, [class*=salary]');var companyEl=item.querySelector('.job-card-footer a, .company-name, [class*=company-name]');var areaEl=item.querySelector('.job-area, [class*=job-area]');var linkEl=item.querySelector('a[href]');var href=linkEl?linkEl.getAttribute('href'):'';if(href&&href.indexOf('http')!==0){href='https://www.zhipin.com'+href;}var tagEls=item.querySelectorAll('.tag-list li, .tag-list span, [class*=job-tag] li');var tags=[];for(var j=0;j<tagEls.length;j++){var x=(tagEls[j].textContent||'').trim();if(x)tags.push(x);}if(titleEl){jobs.push({title:(titleEl.textContent||'').trim(),salary:salaryEl?(salaryEl.textContent||'').trim():'',company:companyEl?(companyEl.textContent||'').trim():'',area:areaEl?(areaEl.textContent||'').trim():'',url:href,tags:tags});}}return JSON.stringify({count:jobs.length,jobs:jobs,source:'dom'});})()
```

**注意**：
- 用户要 N 个岗位就把两处 `slice(0,10)` / `slice.call(...,0,10)` 里的 `10` 都改成 N；默认 10
- Vue 路径拿到的 salary 明文；DOM 路径拿到的 salary 大概率是字体反爬乱码，返回给上游时注明"薪资字段疑似反爬，仅供参考"
- **两条脚本已经压成单行**，agent 复制粘贴时**别加换行/缩进"美化"**，加了就静默返 null

### 7. 收尾
- **不要主动 `close_tab`** —— 保留搜索结果页给用户，方便他自己继续看/继续投递。用户明确说"关掉"才关
- 多城市 / 多关键词多轮时，用 URL 去重（`seen_urls: Set<string>`），也不影响 tab 生命周期

## 输出格式（返回给上游）

```markdown
## 招聘搜索结果

**范围**：关键词 = Go 后端工程师 · 城市 = 北京 / 上海 · 抓取 32 个 · 数据源 vue_data

### 1. 高级 Go 后端开发工程师 · 字节跳动
- 薪资：40-70K · 15薪
- 城市：北京 海淀 中关村
- 要求：3-5 年 · 本科
- 技术栈：Go / gRPC / Kubernetes / Redis
- 公司：D 轮及以上 · 10000人以上 · 互联网
- 链接：https://www.zhipin.com/job_detail/xxx.html

### 2. Go 工程师 · Shopee
...
```

## 硬性纪律

1. **未登录立刻停** — 报告"用户需要先登录 Boss"，别做别的
2. **抓不到就停** — Vue data 找不到 + DOM fallback 拿到 0 个 → 报告"页面结构可能变了"，不要死循环
3. **最多 5 轮 scroll** — 收敛条件到达或轮数满就停
4. **最多 50 个岗位** — 不要贪
5. **只走 bridge** — 不要因为扩展没连就切 browser_use，Boss 那条路进不去
6. **不点击用户 tab 上的内容** — 只操作 agent 自己 open_tab 打开的搜索页
7. **不主动 close_tab / close_session** — 用户 Chrome 保留原样；搜索完的结果页给用户自己看

## 失败处理

| 现象 | 措施 |
|---|---|
| extension_status.ready=false | 立刻报告"用户没装/没启用 Kro Browser Bridge 扩展" |
| 登录检查 `is_logged_in=false` | 立刻停下让用户登录，不要抓 |
| 登录检查显示 `is_login_page: true` | 用户被踢下线了，报告让用户重登 |
| execute_script 返回 `source:"dom"` 且 count=0 | Boss 结构变了或 Vue 挂载在别处，报告页面异常 |
| execute_script 直接**报错**（tool_result ok=false） | **等 2 秒后 `wait_for` 一次再重试**；仍失败停下报告，不要死循环。常见原因：页面 JS 还没跑完 / 页面刚导航 / JS 语法错误 |
| execute_script 返回 payload 巨大导致 tool 慢 | 一次抓 50 个够了；如果 count 明显过大（>100），先 `scroll` 停止扩容 |
| wait_for 超时 | 网络慢或页面卡，报告一次然后继续尝试 extract；仍失败就停 |
| tool 报 page_id not found | 用户可能关了 tab；重新 list_pages 或 open_tab |

### execute_script 稳健用法（**硬性约束**）

以下规矩不遵守，扩展会**静默返 `value: null`**，agent 拿不到任何错误信息盲猜半天。全都是踩坑踩出来的：

1. **单行、无换行、无缩进** ← 最容易被忽视也最致命。脚本源码里**不允许**出现 `\n`。多行写法一律失败。所有语句 `;` 分隔全部塞到一行。SKILL 里给的模板已经压好单行，agent 复制粘贴时**不许"美化"**
2. **IIFE + 显式 return**：`(function(){...return X;})()`。裸表达式（`"hello"`、`1+1`）一律返 null
3. **禁用双引号 `"`**：所有 JS 字符串用单引号 `'`，对象字面量 key 不加引号（`{title:x}` 而不是 `{"title":x}`）。JSON.stringify **返回值**里有 `"` 无所谓，那不是源码
4. **CSS 属性选择器少用嵌套引号**：`[class*=job-name]` 而不是 `[class*="job-name"]`（`job-name` 是合法 CSS3 ident）。含 `/` `:` 等非 ident 字符的属性值（如 href 匹配 URL 片段），改用 JS 遍历判断，别塞到选择器里
5. **DOM expando 可以读**：`document.querySelector('#wrap').__vue__` 这种 Vue 挂在元素上的属性**可以读**（它是 DOM 元素属性，isolated world 能看到）。但 `window.某某` / 直接引用 `_PAGE` 这种 **page world 全局** 大概率读不到，若必须访问用 `try{ ... }catch(e){}` 兜底
6. **分两步走**：先跑简单探测（`.length`）确认有货，再跑抽取；一次抽取超过 20 条容易返 null
7. **返回体控制在 KB 级**：`slice(0, 10)` 限量。用户要 10 个就 10 个，别贪
8. **返回 null 处理**：先 `wait_for(timeout_ms=2000)` 重试一次；仍 null 检查上述 1-7 项是否违规；连续 2 次 null 停下报告，不要死试

## 不该做

- 用 execute_script 跑破坏性操作（修改用户 cookies / localStorage / 提交表单）
- 一次开多个搜索 tab（并行会踩 Boss 频控）
- 假装抓到 —— 没数据就说没数据，别编
