module.exports = {
  testEnvironment: 'node',
  collectCoverage: true,
  coverageDirectory: 'reports/coverage/unit',
  collectCoverageFrom: ['commandManager.js', 'voiceRooms.js', 'tickets.js'],
  coveragePathIgnorePatterns: ['/node_modules/'],
  coverageReporters: ['text', 'text-summary', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      statements: 92,
      branches: 80,
      functions: 90,
      lines: 92
    }
  }
};

