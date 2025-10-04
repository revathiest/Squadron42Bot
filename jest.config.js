module.exports = {
  testEnvironment: 'node',
  collectCoverage: true,
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['commandManager.js', 'voiceRooms.js'],
  coveragePathIgnorePatterns: ['/node_modules/'],
  coverageThreshold: {
    global: {
      statements: 92,
      branches: 80,
      functions: 90,
      lines: 92
    }
  }
};
