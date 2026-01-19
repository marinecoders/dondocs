# Classification Configuration

This document explains how to override the default domain-based classification restrictions for custom deployments.

## Overview

The application uses domain-based classification restrictions by default:
- `.smil.mil` or `.smil` domains: up to SECRET
- `.ic.gov` domains: up to TOP SECRET
- `.mil` or `.gov` domains: up to CONFIDENTIAL or CUI
- Other domains: UNCLASSIFIED only

You can override these restrictions using either:
1. **Environment variables** (build-time configuration)
2. **Config file** (runtime configuration)

## Method 1: Environment Variables (Build-Time)

Set these environment variables when building the application:

```bash
# Maximum allowed classification level
export VITE_CLASSIFICATION_MAX_LEVEL=secret

# Comma-separated list of allowed levels
export VITE_CLASSIFICATION_ALLOWED_LEVELS=unclassified,cui,confidential,secret

# Optional: Override domain detection
export VITE_CLASSIFICATION_OVERRIDE_DOMAIN=example.mil

# Optional: Custom restriction message
export VITE_CLASSIFICATION_OVERRIDE_MESSAGE="Custom deployment - Classification up to SECRET is allowed."

# Build the application
npm run build
```

### Example: Docker Build

```dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# Set classification restrictions
ENV VITE_CLASSIFICATION_MAX_LEVEL=secret
ENV VITE_CLASSIFICATION_ALLOWED_LEVELS=unclassified,cui,confidential,secret
ENV VITE_CLASSIFICATION_OVERRIDE_MESSAGE="Secure deployment - Classification up to SECRET is allowed."

RUN npm run build
```

### Example: CI/CD Pipeline

```yaml
# GitHub Actions example
env:
  VITE_CLASSIFICATION_MAX_LEVEL: secret
  VITE_CLASSIFICATION_ALLOWED_LEVELS: unclassified,cui,confidential,secret
  VITE_CLASSIFICATION_OVERRIDE_MESSAGE: "Production deployment - Classification up to SECRET is allowed."

steps:
  - name: Build
    run: npm run build
```

## Method 2: Config File (Runtime)

Create a `classification.config.json` file in the `public/` directory:

```json
{
  "maxLevel": "secret",
  "allowedLevels": ["unclassified", "cui", "confidential", "secret"],
  "overrideDomain": "example.mil",
  "overrideMessage": "Custom deployment - Classification up to SECRET is allowed."
}
```

### Config File Structure

- `maxLevel` (required): Maximum allowed classification level
  - Valid values: `unclassified`, `cui`, `confidential`, `secret`, `top_secret`, `top_secret_sci`
  
- `allowedLevels` (required): Array of allowed classification levels
  - Must include all levels from `unclassified` up to `maxLevel`
  - Example: If `maxLevel` is `secret`, include: `["unclassified", "cui", "confidential", "secret"]`

- `overrideDomain` (optional): Domain to match for this configuration
  - If not set, the configuration applies to all domains
  - If set, only applies when the current domain matches

- `overrideMessage` (optional): Custom message to display to users
  - If not set, uses default domain-based messages

### Example Config Files

**Allow all levels (IC deployment):**
```json
{
  "maxLevel": "top_secret",
  "allowedLevels": ["unclassified", "cui", "confidential", "secret", "top_secret", "top_secret_sci"],
  "overrideMessage": "Intelligence Community deployment - All classification levels are allowed."
}
```

**Restrict to CUI only:**
```json
{
  "maxLevel": "cui",
  "allowedLevels": ["unclassified", "cui"],
  "overrideMessage": "Limited deployment - Only UNCLASSIFIED and CUI are allowed."
}
```

**Domain-specific override:**
```json
{
  "maxLevel": "secret",
  "allowedLevels": ["unclassified", "cui", "confidential", "secret"],
  "overrideDomain": "secure.example.mil",
  "overrideMessage": "Secure domain - Classification up to SECRET is allowed."
}
```

## Priority Order

Configuration is checked in this order:

1. **Environment variables** (highest priority)
   - Applied at build time
   - Cannot be changed without rebuilding

2. **Config file** (`public/classification.config.json`)
   - Loaded at runtime
   - Can be updated without rebuilding
   - Only used if environment variables are not set

3. **Domain detection** (default)
   - Automatic detection based on current domain
   - Used if no overrides are configured

## Security Considerations

⚠️ **Important Security Notes:**

1. **Environment variables** are embedded in the build and visible in the client-side code. They provide build-time configuration but are not secure for sensitive settings.

2. **Config files** are publicly accessible and can be viewed by anyone. Do not use them for security enforcement.

3. **Domain-based restrictions** are client-side only and can be bypassed. They are intended for **user guidance and compliance**, not security enforcement.

4. For actual security enforcement, implement server-side validation and access controls.

## Troubleshooting

### Config file not loading

- Ensure the file is named exactly `classification.config.json`
- Place it in the `public/` directory (not `src/`)
- Check browser console for fetch errors
- Verify the JSON is valid

### Environment variables not working

- Ensure variables are prefixed with `VITE_`
- Rebuild the application after setting variables
- Check that variables are set before the build command runs

### Domain override not working

- Verify `overrideDomain` matches the actual domain (case-sensitive)
- Check that the domain includes subdomain if specified
- Ensure no environment variables are overriding the config file

## Example: Self-Hosted Deployment

For a self-hosted deployment on `secure.example.mil`:

1. **Create config file:**
   ```bash
   cp public/classification.config.json.example public/classification.config.json
   ```

2. **Edit the config:**
   ```json
   {
     "maxLevel": "secret",
     "allowedLevels": ["unclassified", "cui", "confidential", "secret"],
     "overrideDomain": "secure.example.mil",
     "overrideMessage": "Secure deployment - Classification up to SECRET is allowed."
   }
   ```

3. **Deploy** (the config file will be served with the application)

The configuration will be automatically loaded when users access the application.
