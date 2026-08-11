v6.17 SET/VALUE mapping correction
- Backend live market mapping is now SET = volume-side feed, VALUE = price-side feed.
- User app renders SET as SET and VALUE as VALUE (no display-only trick).
- Live jump behavior follows the corrected fields.
- 2D rule is unchanged: SET last digit + VALUE last digit before decimal.
- v6.16 2-minute hold and v6.15 Admin publish controls are retained.
