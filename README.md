# World News Summary Image — 18 November 2026

[![make.fun · news-image-20261118](https://make.fun/badge/news-image-20261118.svg)](https://make.fun/bounty/news-image-20261118?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261118)
[![rank](https://make.fun/badge/news-image-20261118/budybozz/news-image-20261118-entry/rank.svg)](https://make.fun/bounty/news-image-20261118/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261118)
[![reward](https://make.fun/badge/news-image-20261118/budybozz/news-image-20261118-entry/reward.svg)](https://make.fun/bounty/news-image-20261118?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261118)

Deterministic PNG generator for the make.fun "Sum up 18 November's world news in one image" bounty. Outputs a 512×384 news summary image with 6 stories: Climate (COP32), Tech (EU AI Act), Mideast (Gaza ceasefire), Economy (Fed holds), Space (Artemis IV), Health (mRNA malaria vaccine).

[View the bounty →](https://make.fun/bounty/news-image-20261118)

---

## Run

```bash
# Requires Node.js ≥ 22
npx tsx main.ts
# Output: /output/entry.png (deterministic, ~12 KiB, 512×384)
```

---

## How it works

- Pure TypeScript + Node stdlib (no external dependencies)
- Custom RFC 1951 raw deflate implementation (static Huffman + LZ77)
- Manual PNG encoder with zlib wrapper and Adler-32 checksum
- 2D drawing context with bitmap font rendering
- Deterministic output verified byte-for-byte on re-run

---

## License

MIT

---

## Referral

My make.fun referral: https://make.fun/r/nt0pex79