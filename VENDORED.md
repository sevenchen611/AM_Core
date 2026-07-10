# 下游 vendored 登記册(上游側)

平台的部分檔案被下游專案**原樣複製(vendored)**使用。這裡登記「哪些檔有下游複製品」,
好讓**改上游的人**知道:改完之後,下游不會自動跟上——它會**靜默沿用舊版**,不報錯。

> 這是「上游改了、下游落後」的缺口,本質上與執行期的靜默失敗同類,只是發生在版控層。
> 因此每個被 vendored 的上游檔開頭都留了一行指標指向本檔;看到那行,就代表你正在改一個有下游的檔。

## 為什麼這裡不記各檔的 SHA

會過期。下游 `_platform/meetings/VENDORED.md` 就吃過這個虧——手抄的雜湊忘了更新。
所以本檔只記**不會過期的事實**(哪個檔、下游在哪、怎麼核對),雜湊一律**現場算、現場比**。

## 目前的下游

唯一的下游是 **BuildAM**(同機、不同 repo):`D:\Codex_project\BuildAM\line-oa-webhook\src\_platform\`。

| 上游檔 | 下游複製品 |
|---|---|
| `core/llm.js` | `BuildAM/line-oa-webhook/src/_platform/llm.js` |
| `modules/meetings/index.js` | `BuildAM/line-oa-webhook/src/_platform/meetings/index.js` |

下游端每個 vendored 資料夾另有自己的 `VENDORED.md`,記著它對齊的上游 commit 與複製日期。

## 改完上游後要做的事

1. 在本檔的表格確認你改的檔有沒有下游。沒有就不用管。
2. 有的話,把新版複製過去,並更新下游那份 `VENDORED.md` 的來源 commit / 日期：
   ```sh
   cp core/llm.js               ../BuildAM/line-oa-webhook/src/_platform/llm.js
   cp modules/meetings/index.js ../BuildAM/line-oa-webhook/src/_platform/meetings/index.js
   ```
3. 若一時不便同步,**至少在你的 commit 訊息裡點名 BuildAM 需要 re-vendor**,別讓它靜默落後。

## 現場核对下游是否已同步

在 `AM_Core` 目錄執行(兩邊雜湊相同＝同步,不同＝下游落後、需重抄)：

```sh
for f in "core/llm.js:_platform/llm.js" "modules/meetings/index.js:_platform/meetings/index.js"; do
  up="${f%%:*}"; down="../BuildAM/line-oa-webhook/src/${f##*:}"
  a=$(git show HEAD:"$up" | sha256sum | cut -d' ' -f1)
  b=$(sha256sum "$down" | cut -d' ' -f1)
  [ "$a" = "$b" ] && echo "同步  $up" || echo "落後  $up  ←  需 re-vendor"
done
```

## 為什麼是 vendored 而不是 submodule / npm 套件

暫時的。平台 `core/` 運行時上線後會統一收斂相依機制。現在用複製,是為了讓 BuildAM
不必跨 repo 相依就能綁定平台邏輯,不影響其現行部署。收斂之後本檔即可退役。
