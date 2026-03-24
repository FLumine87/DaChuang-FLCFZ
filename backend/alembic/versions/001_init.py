"""init database

Revision ID: 001
Create Date: 2026-03-22

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'users',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('username', sa.String(50), nullable=False),
        sa.Column('password_hash', sa.String(255), nullable=False),
        sa.Column('name', sa.String(50), nullable=False),
        sa.Column('role', sa.String(20), nullable=True, default='counselor'),
        sa.Column('department', sa.String(100), nullable=True),
        sa.Column('phone', sa.String(20), nullable=True),
        sa.Column('email', sa.String(100), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=True, default=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('username'),
    )
    op.create_index(op.f('ix_users_id'), 'users', ['id'], unique=False)
    op.create_index(op.f('ix_users_username'), 'users', ['username'], unique=True)

    op.create_table(
        'questionnaires',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('code', sa.String(20), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('max_score', sa.Integer(), nullable=False),
        sa.Column('questions', sa.Text(), nullable=True),
        sa.Column('scoring_rules', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Integer(), nullable=True, default=1),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('code'),
    )

    op.create_table(
        'screenings',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('screening_id', sa.String(20), nullable=False),
        sa.Column('name', sa.String(50), nullable=False),
        sa.Column('age', sa.Integer(), nullable=True),
        sa.Column('gender', sa.String(10), nullable=True),
        sa.Column('department', sa.String(100), nullable=True),
        sa.Column('phone', sa.String(20), nullable=True),
        sa.Column('questionnaire_id', sa.Integer(), nullable=False),
        sa.Column('score', sa.Integer(), nullable=True, default=0),
        sa.Column('max_score', sa.Integer(), nullable=True, default=100),
        sa.Column('answers', sa.Text(), nullable=True),
        sa.Column('status', sa.String(20), nullable=True, default='pending'),
        sa.Column('alert_level', sa.String(20), nullable=True, default='green'),
        sa.Column('counselor_id', sa.Integer(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('screening_date', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['questionnaire_id'], ['questionnaires.id']),
        sa.ForeignKeyConstraint(['counselor_id'], ['users.id']),
    )
    op.create_index(op.f('ix_screenings_id'), 'screenings', ['id'], unique=False)
    op.create_index(op.f('ix_screenings_screening_id'), 'screenings', ['screening_id'], unique=True)

    op.create_table(
        'alert_rules',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('questionnaire_id', sa.Integer(), nullable=True),
        sa.Column('min_score', sa.Integer(), nullable=True),
        sa.Column('max_score', sa.Integer(), nullable=True),
        sa.Column('alert_level', sa.String(20), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Integer(), nullable=True, default=1),
        sa.Column('priority', sa.Integer(), nullable=True, default=0),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['questionnaire_id'], ['questionnaires.id']),
    )

    op.create_table(
        'alerts',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('alert_id', sa.String(20), nullable=False),
        sa.Column('screening_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(50), nullable=False),
        sa.Column('level', sa.String(20), nullable=True, default='green'),
        sa.Column('trigger', sa.String(200), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('status', sa.String(20), nullable=True, default='pending'),
        sa.Column('assignee_id', sa.Integer(), nullable=True),
        sa.Column('follow_up_notes', sa.Text(), nullable=True),
        sa.Column('resolved_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['screening_id'], ['screenings.id']),
        sa.ForeignKeyConstraint(['assignee_id'], ['users.id']),
    )
    op.create_index(op.f('ix_alerts_id'), 'alerts', ['id'], unique=False)
    op.create_index(op.f('ix_alerts_alert_id'), 'alerts', ['alert_id'], unique=True)

    op.create_table(
        'case_tag_master',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(50), nullable=False),
        sa.Column('color', sa.String(10), nullable=True, default='#3b82f6'),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name'),
    )

    op.create_table(
        'cases',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('case_id', sa.String(20), nullable=False),
        sa.Column('name', sa.String(50), nullable=False),
        sa.Column('age', sa.Integer(), nullable=True),
        sa.Column('gender', sa.String(10), nullable=True),
        sa.Column('department', sa.String(100), nullable=True),
        sa.Column('phone', sa.String(20), nullable=True),
        sa.Column('id_number', sa.String(20), nullable=True),
        sa.Column('alert_level', sa.String(20), nullable=True, default='green'),
        sa.Column('status', sa.String(20), nullable=True, default='active'),
        sa.Column('counselor_id', sa.Integer(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('screening_count', sa.Integer(), nullable=True, default=0),
        sa.Column('last_screening_date', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['counselor_id'], ['users.id']),
    )
    op.create_index(op.f('ix_cases_id'), 'cases', ['id'], unique=False)
    op.create_index(op.f('ix_cases_case_id'), 'cases', ['case_id'], unique=True)

    op.create_table(
        'case_tags_association',
        sa.Column('case_id', sa.Integer(), nullable=False),
        sa.Column('tag_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['case_id'], ['cases.id']),
        sa.ForeignKeyConstraint(['tag_id'], ['case_tag_master.id']),
        sa.PrimaryKeyConstraint('case_id', 'tag_id'),
    )

    op.create_table(
        'case_timeline',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('case_id', sa.Integer(), nullable=False),
        sa.Column('event_type', sa.String(50), nullable=False),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('event_date', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['case_id'], ['cases.id']),
    )

    op.create_table(
        'media_files',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('file_id', sa.String(20), nullable=False),
        sa.Column('screening_id', sa.Integer(), nullable=True),
        sa.Column('file_type', sa.String(20), nullable=False),
        sa.Column('file_name', sa.String(255), nullable=False),
        sa.Column('file_path', sa.String(500), nullable=False),
        sa.Column('file_size', sa.Integer(), nullable=True, default=0),
        sa.Column('mime_type', sa.String(100), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('analysis_result', sa.Text(), nullable=True),
        sa.Column('uploaded_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['screening_id'], ['screenings.id']),
        sa.ForeignKeyConstraint(['uploaded_by'], ['users.id']),
    )
    op.create_index(op.f('ix_media_files_id'), 'media_files', ['id'], unique=False)
    op.create_index(op.f('ix_media_files_file_id'), 'media_files', ['file_id'], unique=True)


def downgrade() -> None:
    op.drop_table('media_files')
    op.drop_table('case_timeline')
    op.drop_table('case_tags_association')
    op.drop_table('cases')
    op.drop_table('case_tag_master')
    op.drop_table('alerts')
    op.drop_table('alert_rules')
    op.drop_table('screenings')
    op.drop_table('questionnaires')
    op.drop_table('users')
