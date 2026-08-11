Tartay 2D v6.3
Reference: user-supplied nz-six-times-2d-main.zip

Matched sample timing:
- Live/frame change step: 10,000 ms
- Blink/jump trigger: 3,500 ms
- Blink animation duration: 0.82 s
- Big 2D + active SET + active VALUE blink together.
- Big 2D rule remains:
  SET last digit + VALUE last digit before decimal.
  Example SET 1367.42 / VALUE 56789.81 => 29.
- Active round row 2D remains -- until result is released.
- Existing Tartay 8-round UI/API/DB structure retained.
