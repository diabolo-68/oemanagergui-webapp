import { defineConfig } from 'vitest/config';

export default defineConfig({
    server: {
        // The workspace folder may be a junction that Node resolves to a different
        // drive (e.g. D:\). Vite's strict fs check would reject such cross-drive
        // setupFile paths. Disable strict fs to allow loading setup.js after
        // symlink/junction resolution.
        fs: { strict: false }
    },
    resolve: {
        preserveSymlinks: true
    },
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./tests/setup.js'],
        include: ['tests/**/*.test.js'],
        coverage: {
            provider: 'istanbul',
            reporter: ['text', 'html', 'lcov'],
            include: ['js/**/*.js'],
            exclude: ['js/**/*.test.js'],
            thresholds: {
                statements: 60,
                branches: 50,
                functions: 60,
                lines: 60
            }
        }
    }
});




