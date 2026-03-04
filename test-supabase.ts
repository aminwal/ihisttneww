import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data, error } = await supabase.from('timetable_drafts').select('id').limit(1);
  console.log('Select:', { data, error });
  
  const { error: insError } = await supabase.from('timetable_drafts').insert([{
    id: 'test-id',
    section: 'test',
    wing_id: 'test',
    grade_id: 'test',
    section_id: 'test',
    class_name: 'test',
    day: 'Monday',
    slot_id: 1,
    subject: 'test',
    subject_category: 'test',
    teacher_id: 'test',
    teacher_name: 'test',
    room: 'test',
    is_substitution: false,
    is_manual: false
  }]);
  console.log('Insert:', insError);
  
  if (!insError) {
    await supabase.from('timetable_drafts').delete().eq('id', 'test-id');
  }
}

test();
