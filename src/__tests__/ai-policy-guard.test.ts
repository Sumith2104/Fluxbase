import { describe, it, expect } from 'vitest';
import { checkOffTopicPolicy } from '@/lib/ai-policy-guard';

describe('Fluxbase AI Policy Guard', () => {
    describe('Off-Topic: Leaf, Plant & Crop Disease Detection', () => {
        it('rejects leaf disease identification queries', () => {
            const res = checkOffTopicPolicy('Can you identify what disease this leaf has?');
            expect(res.isOffTopic).toBe(true);
            expect(res.reason).toBe('leaf_or_plant_disease_diagnosis');
            expect(res.refusalText).toContain('Fluxbase');
        });

        it('rejects plant sickness or pest inspection', () => {
            const res = checkOffTopicPolicy('My tomato plant has brown spots and blight, how do I cure it?');
            expect(res.isOffTopic).toBe(true);
            expect(res.reason).toBe('leaf_or_plant_disease_diagnosis');
        });

        it('rejects attached image with leaf / plant query', () => {
            const res = checkOffTopicPolicy('Look at this photo of my crop', true);
            expect(res.isOffTopic).toBe(true);
            expect(res.reason).toBe('non_database_image_upload');
        });

        it('rejects generic photo inspection on attached images', () => {
            const res = checkOffTopicPolicy('What kind of plant is this picture?', true);
            expect(res.isOffTopic).toBe(true);
            expect(res.reason).toBe('non_database_image_upload');
        });
    });

    describe('Off-Topic: Standalone Python & ML Scripts', () => {
        it('rejects requests to write Python code for leaf disease detection', () => {
            const res = checkOffTopicPolicy('Write python code to detect leaf diseases');
            expect(res.isOffTopic).toBe(true);
            expect(res.refusalText).toContain('standalone Python machine learning');
        });

        it('rejects requests for PyTorch/OpenCV scripts', () => {
            const res = checkOffTopicPolicy('Write a python script using opencv for image classification');
            expect(res.isOffTopic).toBe(true);
            expect(res.reason).toBe('standalone_python_or_ml_request');
        });

        it('rejects requests to write general python programs', () => {
            const res = checkOffTopicPolicy('Write python code to train a model');
            expect(res.isOffTopic).toBe(true);
        });

        it('rejects "can you create py code?"', () => {
            const res = checkOffTopicPolicy('can you create py code?');
            expect(res.isOffTopic).toBe(true);
            expect(res.reason).toBe('standalone_python_or_ml_request');
            expect(res.refusalText).toContain('I cannot generate standalone Python applications');
        });

        it('rejects "can you write python?"', () => {
            const res = checkOffTopicPolicy('can you write python?');
            expect(res.isOffTopic).toBe(true);
            expect(res.reason).toBe('standalone_python_or_ml_request');
        });

        it('rejects requests to create Flask/Django apps', () => {
            const res = checkOffTopicPolicy('Create a flask app with registration and login endpoints');
            expect(res.isOffTopic).toBe(true);
            expect(res.reason).toBe('standalone_python_or_ml_request');
        });

        it('rejects generic app creation without database context', () => {
            const res = checkOffTopicPolicy('Can you write code for a login system?');
            expect(res.isOffTopic).toBe(true);
        });
    });

    describe('Off-Topic: General Non-Fluxbase Inquiries', () => {
        it('rejects cooking recipes', () => {
            const res = checkOffTopicPolicy('Write a recipe for chocolate chip cookies');
            expect(res.isOffTopic).toBe(true);
            expect(res.reason).toBe('general_off_topic');
        });

        it('rejects creative writing / poems', () => {
            const res = checkOffTopicPolicy('Write a poem about the sunrise');
            expect(res.isOffTopic).toBe(true);
            expect(res.reason).toBe('general_off_topic');
        });
    });

    describe('On-Topic: Permitted Fluxbase 4 Core Pillars', () => {
        it('allows creating tables even with plant/crop domain names', () => {
            const res = checkOffTopicPolicy('CREATE TABLE crop_diseases (id serial primary key, crop_name text, disease text, confidence float);');
            expect(res.isOffTopic).toBe(false);
        });

        it('allows querying tables even with crop or leaf names', () => {
            const res = checkOffTopicPolicy('SELECT * FROM plant_records WHERE disease = \'blight\';');
            expect(res.isOffTopic).toBe(false);
        });

        it('allows asking how to connect Python backend to Fluxbase', () => {
            const res = checkOffTopicPolicy('How do I connect Python to Fluxbase using SQLAlchemy and postgresql URI?');
            expect(res.isOffTopic).toBe(false);
        });

        it('allows dashboard navigation requests', () => {
            const res = checkOffTopicPolicy('Take me to the SQL query editor');
            expect(res.isOffTopic).toBe(false);
        });

        it('allows mock data generation requests', () => {
            const res = checkOffTopicPolicy('Generate 500 rows of mock data for the orders table using generate_series');
            expect(res.isOffTopic).toBe(false);
        });

        it('allows inspecting database schema', () => {
            const res = checkOffTopicPolicy('What tables exist in my database schema?');
            expect(res.isOffTopic).toBe(false);
        });
    });

    describe('Immediate Stop & Cancellation Handling', () => {
        it('immediately halts when user says "stop"', () => {
            const res = checkOffTopicPolicy('stop');
            expect(res.isOffTopic).toBe(true);
            expect(res.reason).toBe('stop_command');
            expect(res.refusalText).toContain('Generation stopped');
        });

        it('immediately halts when user says "stop it" or "please stop"', () => {
            const res = checkOffTopicPolicy('please stop');
            expect(res.isOffTopic).toBe(true);
            expect(res.reason).toBe('stop_command');
        });

        it('immediately halts when user says "cancel" or "abort"', () => {
            const res = checkOffTopicPolicy('cancel');
            expect(res.isOffTopic).toBe(true);
            expect(res.reason).toBe('stop_command');
        });
    });
});
