# Project Notes

- Server code uses CommonJS, Express, and `mysql2/promise` with parameterized SQL.
- Keep database credentials in the ignored `.env`; `.env.example` must contain placeholders only.
- Preserve the `IT/public` and `IT/views` static frontend layout.
- Run `npm start` after MySQL schema and environment setup.
