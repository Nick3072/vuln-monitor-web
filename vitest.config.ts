import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // node:sqlite 은 Node.js 22+ 실험적 기능 — Workers 환경이 아닌 node 에서 실행
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
})
