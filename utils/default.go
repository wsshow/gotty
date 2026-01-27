package utils

import (
	"fmt"
	"reflect"
	"strconv"

	"github.com/fatih/structs"
)

func ApplyDefaultValues(struct_ interface{}) (err error) {
	o := structs.New(struct_)

	for _, field := range o.Fields() {
		defaultValue := field.Tag("default")
		if defaultValue == "" {
			continue
		}
		var val any
		switch field.Kind() {
		case reflect.String:
			val = defaultValue
		case reflect.Bool:
			switch defaultValue {
			case "true":
				val = true
			case "false":
				val = false
			default:
				return fmt.Errorf("invalid bool expression: %v, use true/false", defaultValue)
			}
		case reflect.Int:
			val, err = strconv.Atoi(defaultValue)
			if err != nil {
				return err
			}
		default:
			val = field.Value()
		}
		field.Set(val)
	}
	return nil
}
