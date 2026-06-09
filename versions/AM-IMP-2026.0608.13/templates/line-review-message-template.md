# LINE Review Message Template

```text
【判斷校準】{reviewId}
專案：{projectKey}
任務：{taskTitle}
來源：{sourceType}

我的判斷：
{assistantJudgment}

我判斷的理由：
{assistantReason}

不確定點：
{uncertainty}

請回覆：
方向：{建立任務 / 不是任務 / 暫緩 / 拆任務 / 改專案 / 補資料 / 其他}
原因：{why}
規則：{optional reusable rule}
例外：{optional exceptions}
```

Keep messages short enough for LINE and omit secrets, production IDs, customer-private content, and attachment details.
