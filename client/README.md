# Granite School Management System

Granite School Management System is a production-grade, multi-tenant platform designed to manage academic and administrative operations for schools.  
It provides structured control over students, classes, exams, results, fees, reporting, and system settings using role-based access and tenant isolation.

Granite is built as a real system — not a demo — with stability, clarity, and scalability in mind.

---

## Core Capabilities

### Academic Management
- Student registration and lifecycle management
- Class and stream management
- Teacher assignment and subject mapping
- Attendance tracking

### Exams & Results
- Exam creation and session management
- Marks entry with validation and locking
- Class-level and student-level result views
- Result publishing workflow
- Print-ready result slips and reports

### Fees Management
- Fee structures and billing
- Student fee balances
- Payment tracking
- Financial summaries and reports
- Print-friendly receipts and statements

### Reporting & Printing
- Academic and financial reports
- Print-optimized layouts
- Consistent headers and formatting across documents

### Administration & Control
- Multi-tenant school isolation
- Role-based access control
- System settings and branding
- Audit logging for critical actions
- Security and policy configuration

---

## System Roles

Granite supports structured role separation to maintain control and accountability:

- **SYSTEM_ADMIN**
  - Global system oversight
  - Tenant (school) management
  - Platform-level settings and policies

- **ADMIN**
  - School-level administration
  - Students, teachers, classes, exams, and fees

- **TEACHER / STAFF**
  - Academic operations based on assigned permissions

Roles are enforced both at the API level and within the UI.

---

## Architecture Overview

Granite follows a clean client-server architecture with strict separation of concerns.

### Frontend
- Single-page application
- Role-aware navigation and guarded routes
- Print-friendly UI components
- Centralized API access layer

### Backend
- RESTful API
- JWT-based authentication
- Role and permission enforcement
- Tenant isolation per school
- Centralized error handling and audit logging

### Database
- Relational schema
- Strong data integrity via Prisma ORM
- Clear entity relationships (students, classes, exams, fees, users)

---

## Tech Stack

### Frontend
- React
- Vite
- Tailwind CSS
- shadcn/ui
- React Query

### Backend
- Node.js
- Express
- Prisma ORM

### Database
- PostgreSQL

### Authentication
- JWT-based authentication
- Role-based authorization

---

## Screenshots

> Add screenshots here for portfolio use:
- Dashboard overview
- Students management
- Exams and results
- Fees and reports
- Settings and audit logs

(Example filenames: `granite-dashboard.png`, `granite-results.png`, etc.)

---

## Local Development Setup

### Prerequisites
- Node.js (v18+ recommended)
- PostgreSQL
- npm or yarn

---

