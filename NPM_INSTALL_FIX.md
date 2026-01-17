# NPM Install Fix Summary

## Issue
The repository had an npm install failure caused by `@screeps/driver@5.2.5` attempting to build native modules using `node-gyp@3.8.0`, which has Python 2 syntax incompatible with Python 3.

## Error Message
```
npm error gyp ERR! stack Error: Command failed: /usr/bin/python3 -c import sys; print "%s.%s.%s" % sys.version_info[:3];
npm error gyp ERR! stack   File "<string>", line 1
npm error gyp ERR! stack     import sys; print "%s.%s.%s" % sys.version_info[:3];
npm error gyp ERR! stack                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
npm error gyp ERR! stack SyntaxError: Missing parentheses in call to 'print'. Did you mean print(...)?
```

## Solution
Moved `screeps-server-mockup` (which depends on `@screeps/driver`) from `devDependencies` to `optionalDependencies` in `packages/screeps-server/package.json`.

### Why This Works
1. **Optional dependencies** allow npm to continue installation even if the dependency fails to install
2. The `screeps-server-mockup` package is only needed for local server testing
3. The test infrastructure already has fallbacks when this package is unavailable (see `packages/screeps-server/test/helpers/server-helper.ts`)
4. The core functionality of the bot doesn't require the local server testing package

## Changes Made
- `packages/screeps-server/package.json`: Moved `screeps-server-mockup` to `optionalDependencies`

## Verification
```bash
# Clean install works
npm install
# Exit code: 0 ✅

# Build works
npm run build
# Exit code: 0 ✅
```

## Known Warnings
The following warning still appears but is **not an error**:
```
npm warn deprecated eslint@5.16.0: This version is no longer supported.
```

This warning comes from `@screeps/common@2.15.5` (a transitive dependency from `screeps-server-mockup`) and does not prevent installation or building.

## Alternative Solutions Attempted
1. ❌ **Upgrading node-gyp**: Caused dependency conflicts (missing `proc-log`, `tar`, etc.)
2. ❌ **Patching C++ source files**: Required too many patches for both `@screeps/driver` and `isolated-vm`
3. ❌ **Using --ignore-scripts**: Worked but broke workspace linking
4. ✅ **Making dependency optional**: Clean, simple, and leverages existing fallback logic

## Future Improvements
If full local server testing is needed in the future, consider:
- Using a containerized Screeps server instead of native modules
- Switching to a maintained alternative to `screeps-server-mockup`
- Waiting for upstream fixes to `@screeps/driver` for Python 3 compatibility
