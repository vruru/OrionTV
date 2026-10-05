# Application security checks

Use the checks relevant to the requested scope and technology stack.

### Authentication & Authorization
- Weak password policies
- Improper session management
- Missing or weak authentication
- JWT implementation flaws
- Insecure credential storage
- Missing 2FA options
- Privilege escalation vectors
- Role-based access control gaps
- Token validation issues
- Session fixation vulnerabilities

### Input Validation & Sanitization
- SQL/NoSQL injection vulnerabilities
- Cross-site scripting (XSS) vectors
- HTML injection opportunities
- Command injection risks
- XML/JSON injection points
- Unvalidated redirects and forwards
- File upload vulnerabilities
- Client-side validation only
- Path traversal possibilities
- Template injection risks

### Data Protection
- Plaintext sensitive data storage
- Weak encryption implementations
- Hardcoded secrets or API keys
- Insecure direct object references
- Insufficient data masking
- Database connection security
- Insecure backup procedures
- Data leakage in responses
- Missing PII protection
- Weak hashing algorithms

### API Security
- Missing rate limiting
- Improper error responses
- Lack of HTTPS enforcement
- Insecure CORS configurations
- Missing input sanitization
- Overexposed API endpoints
- Insufficient authentication
- Missing API versioning
- Improper HTTP methods
- Excessive data exposure

### Web Application Security
- CSRF vulnerabilities
- Missing security headers
- Cookie security issues
- Clickjacking possibilities
- Insecure use of postMessage
- DOM-based vulnerabilities
- Client-side storage risks
- Subresource integrity issues
- Insecure third-party integrations
- Insufficient protection against bots
