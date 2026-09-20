# Security Engineering Projects

This is the main repo for the engineering side of my work. I keep security architecture, secure software, automation, database work, mobile prototypes, and sanitized HR analytics projects here.

I split application security and Hack The Box into separate repos so this one stays focused on things I built, designed, or automated.

## Project map

| Area | Project | What I actually did | Public proof |
|---|---|---|---|
| Security architecture | [Private Data Logging Security Design Review](security-design-review/README.md) | Reviewed a logging architecture, identified two design risks, prioritized them, and proposed a schema validation layer plus central policy enforcement | Sanitized design review |
| Threat modeling | [Online Banking Security Architecture](online-banking-threat-model/README.md) | Recreated a banking DFD in IriusRisk, reviewed threats, mapped controls, and documented STRIDE based risks | Threat assessment, security requirements, methodology notes |
| Secure software | [Secure Lo Fi Study Cafe](secure-lofi-study-cafe/README.md) | Built and self-hosted a production multi-user Node.js/Express/Socket.IO application with persistent rooms/memberships, authenticated realtime presence, bcrypt sessions, server-side RBAC, CSRF protection, SQLite WAL persistence, hardened systemd controls, verified backups, indexed security telemetry, and multi-client integration tests | `server.js`, `database.js`, `schema.sql`, `sql/security-forensics.sql`, v4.0.1 self-hosted realtime security engineering release |
| Static analysis | [C and C++ Static Analysis](cpp-static-analysis/README.md) | Ran Flawfinder against a C++ program, reviewed 31 findings, and separated tool warnings from actual risk | Sanitized Flawfinder summary |
| Database team project | [Dating Application Database Team Project](dating-database-team-project/README.md) | Worked in a three person class team and served as the mock project manager while the group designed a database application | Project status and role documented; source is not public yet |
| Python automation | [Nova Local Assistant](nova-local-assistant/README.md) | Built a local Python assistant with system diagnostics, research workflows, voice, Windows automation, and local model integration | Sanitized diagnostics source plus retained local versions |
| HR data and automation | [HR Analytics and Automation](workforce-analytics-automation/README.md) | Built reporting logic, vacancy and hiring analysis, Excel VBA automation, reconciliation checks, workflow tracking, and recurring audits | Sanitized VBA sample and detailed project notes |
| Android | [Android Mobile Prototypes](android-mobile-prototypes/README.md) | Built a Reply Time Tracker in Kotlin and Jetpack Compose and tested an HR workflow prototype on Android | Sanitized Kotlin source for the Reply Time Tracker |
| Embedded systems / hardware | [Embedded Systems & Hardware Build](electrical-engineering-research-toolkit/README.md) | Built and wired the physical hardware, programmed microcontrollers, integrated sensors, designed circuits and schematics, implemented UART/I²C/SPI communication, and worked across ESP32, Arduino, and Raspberry Pi platforms | Detailed project writeup plus retained Nova research tooling |

## How I organize the repo

```text
security design
    |
    +--> threat modeling
    +--> secure software
    +--> static analysis

automation
    |
    +--> Python
    +--> VBA
    +--> HR analytics
    +--> mobile prototypes

embedded systems
    |
    +--> microcontrollers
    +--> sensors
    +--> UART / I²C / SPI
    +--> circuit + schematic design
    +--> hardware assembly

research tooling
    |
    +--> engineering source routing
```

## Related repos

* [Application Security Labs](https://github.com/andyspyro/Application-security-labs)
* [Offensive Security Labs](https://github.com/andyspyro/Offensive-Security-labs)
* [Cybersecurity Portfolio](https://github.com/andyspyro/Cybersecurity-Portfolio)

## Public data rules

Everything here is sanitized before it goes public.

* No employee or applicant names
* No employee, position, requisition, or student IDs
* No employer or facility identifiers
* No production exports
* No passwords, private keys, tokens, or API secrets
* No Hack The Box flags
* No copied instructor source code

When original source is unavailable, the repository documents that limitation explicitly rather than presenting reconstructed material as retained source.
