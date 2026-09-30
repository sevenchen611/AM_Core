`POST /api/v1/line/replies` accepts one `actions` item with `inline:true`.
The gateway returns one Flex message with the receipt and underlined result
label in the same horizontal text row; no additional footer button card is
created. Only the result-label text component handles the postback action; the
rest of the sentence remains ordinary text.
