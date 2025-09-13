# TaskRush (A3)

https://a3-persistence-a25-etyo.onrender.com

TaskRush is a single-page task planner application that allows users to create, manage, and track their tasks with priorities, deadlines, and time estimates. The application features user authentication, persistent data storage using MongoDB, and a responsive UI built with Bootstrap.

- **Goal of the application**: To provide users with a simple yet effective tool for planning and organizing tasks, with features like priority levels, deadline tracking, and urgency scoring to help users focus on what matters most.
- **Challenges faced**: Implementing user authentication and session management was challenging, especially ensuring secure password hashing and proper session handling. Converting from in-memory storage to MongoDB required careful schema design and data migration considerations.
- **Authentication strategy**: I chose session-based authentication with username/password because it was straightforward to implement and provides adequate security for this application. Accounts are created automatically on first login, which simplifies the user experience.
- **CSS framework used**: I used Bootstrap 5 because it provides a comprehensive set of responsive components and utilities that create a professional-looking interface without requiring extensive custom CSS work.
  - **Modifications made**: I added custom CSS variables for theming (colors, fonts) and some responsive adjustments, but Bootstrap handles the majority of the styling.
- **Express middleware packages used**:
  - `compression`: Enables gzip/Brotli compression for better performance
  - `express-session`: Manages user sessions for authentication
  - `connect-mongo`: Stores session data in MongoDB for persistence
  - `requireAuth` (custom function): Middleware that checks for valid user sessions before allowing access to protected routes

## Technical Achievements

- **Performance Optimization**: Implemented compression middleware and cache headers to achieve high Lighthouse Performance scores.

### Design/Evaluation Achievements

- **Accessibility Implementation**: Added semantic HTML structure, proper form labels, ARIA attributes via Bootstrap components, and keyboard navigation support to meet accessibility guidelines.
