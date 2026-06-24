# Universal AI Context Engine (VS Code Extension)

## Vision

Build a local-first **VS Code extension + Context Engine** that provides
persistent project memory across AI assistants (Claude, Cursor, ChatGPT,
Antigravity, etc.). Instead of relying on chat history, the system
maintains a structured knowledge base of the project and automatically
supplies relevant context for every new AI session.

------------------------------------------------------------------------

# Problem

Current AI tools suffer from:

-   Limited context windows
-   Loss of conversation history when starting a new session
-   Repeated explanations of architecture and progress
-   No shared memory across AI providers

Goal: **"Open a new AI session and continue working without
re-explaining the project."**

------------------------------------------------------------------------

# High-Level Architecture

``` text
                 VS Code Extension
                        |
        +---------------+----------------+
        |               |                |
    Sidebar UI      Commands       Status Bar
                        |
                        v
          Local Context API (localhost)
                        |
   +---------+----------+----------+---------+
   |         |                     |         |
Scanner   Memory Engine      Git Engine  Embeddings
   |         |                     |         |
   +---------+----------+----------+---------+
                        |
          SQLite + Vector Database (Qdrant)
```

------------------------------------------------------------------------

# Core Components

## 1. Project Scanner

Responsibilities:

-   Detect frameworks and languages
-   Parse README and configuration files
-   Generate project summary
-   Build dependency graph

## 2. File Watcher

Automatically:

-   Detect file creation
-   Detect modifications
-   Detect deletions
-   Update project memory

Recommended library:

-   chokidar

## 3. Git Intelligence

Store:

-   Commit summaries
-   Files modified
-   Features added
-   Bugs fixed
-   Author
-   Timestamp

## 4. Session Manager

Every AI interaction becomes:

-   User prompt
-   AI response
-   Session summary
-   Files referenced
-   Tasks created
-   Decisions made

------------------------------------------------------------------------

# Memory Layers

## Long-Term Memory

Stores:

-   Architecture
-   Coding standards
-   Folder structure
-   Business rules
-   Technology stack

## Working Memory

Stores:

-   Current sprint
-   Current task
-   TODOs
-   Active branch
-   Open issues

## Session Memory

Stores:

-   Current discussion
-   Temporary decisions
-   Recent prompts
-   Next steps

------------------------------------------------------------------------

# Smart Context Builder

Instead of sending the whole repository:

User Prompt:

> Continue implementing authentication.

The engine retrieves:

-   Architecture
-   Relevant files
-   Recent commits
-   Current TODOs
-   Previous session summary

and builds a compact context packet for the AI.

------------------------------------------------------------------------

# VS Code Extension Features

## AI Memory Sidebar

Display:

-   Project
-   Current task
-   Sprint progress
-   Recent sessions
-   Open TODOs

## Commands

-   AI: Continue Previous Session
-   AI: Save Session
-   AI: Update Memory
-   AI: Generate Summary
-   AI: Explain Architecture

## Timeline

Visual history of:

-   Features implemented
-   Bugs fixed
-   Documentation updates
-   Sessions completed

------------------------------------------------------------------------

# Storage

## SQLite

Tables:

-   projects
-   sessions
-   tasks
-   decisions
-   summaries
-   commits

## Vector Database

Store embeddings for:

-   README
-   Architecture
-   Code summaries
-   API documentation
-   Session summaries
-   Meeting notes

------------------------------------------------------------------------

# Recommended Tech Stack

Backend

-   NestJS

Extension

-   VS Code Extension API
-   React (Webview)

Storage

-   SQLite
-   Qdrant

Utilities

-   Prisma
-   simple-git
-   chokidar
-   BullMQ

Embeddings

-   BGE Small
-   Nomic Embed

------------------------------------------------------------------------

# Folder Structure

``` text
universal-context/

apps/
    extension/
    api/

packages/
    scanner/
    context-builder/
    memory/
    git-engine/
    embeddings/

storage/
    sqlite/
    qdrant/
```

------------------------------------------------------------------------

# Future Roadmap

## Phase 1 (MVP)

-   Project scanner
-   SQLite storage
-   File watcher
-   Session manager
-   CLI

## Phase 2

-   Context builder
-   Git intelligence
-   Automatic summaries

## Phase 3

-   Vector search
-   Semantic retrieval
-   Local embeddings

## Phase 4

-   VS Code dashboard
-   Multi-AI integrations
-   One-click "Continue Previous Session"

------------------------------------------------------------------------

# Long-Term Vision

Transform the extension into a universal developer memory system that
continuously builds a **Project Brain**:

-   Architecture graph
-   Decision history
-   Task tracking
-   Session summaries
-   Git intelligence
-   Documentation knowledge
-   Semantic search

Any AI assistant can query this Project Brain and immediately
understand:

-   Where the project stands
-   What changed recently
-   What remains to be implemented
-   Which files are relevant

Result:

**Persistent AI collaboration across every coding assistant without
repeatedly explaining project context.**
