# Inline result links for UOF approval replies

Status: Ready. The LINE reply endpoint accepts `inline:true` on exactly one
action and combines the receipt with a styled result link in one compact Flex
bubble. The existing postback continues to route to UOF's result check, and the
reply path does not append a separate button card or fall back to Push.
